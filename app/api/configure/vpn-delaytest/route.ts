import { NextRequest, NextResponse } from "next/server";
import net from "net";
import { requireConfigureUser } from "@/lib/auth/configure-auth";
import { loadUserVpnStore, saveUserVpnStore } from "@/lib/vpn/user-storage";
import { resolveEntryServers } from "@/lib/vpn/reconfigure";

/**
 * POST /api/configure/vpn-delaytest
 *
 * Misura il delay (latenza) dei server VLESS dell'utente autenticato.
 *
 * - Voce ATTIVA: interroga la Clash API di sing-box (experimental.clash_api),
 *   che espone TUTTI gli outbound `u{userId}-*` (inclusi i suffissi dedup
 *   " #2", " #3", ... generati da buildMultiUserSingBoxConfig). Leggendo i
 *   nomi direttamente da GET /proxies non duplichiamo la logica di dedup.
 * - Voci NON attive: i loro outbound NON sono nella config sing-box, quindi
 *   facciamo un TCP connect diretto a host:port (latenza di handshake) —
 *   utile per confrontare i server salvati prima di attivarli.
 *
 * Endpoint sing-box:
 *   GET  http://sing-box:9090/proxies
 *   GET  http://sing-box:9090/proxies/{name}/delay?timeout=2000&url=...
 *
 * Body: { serverId?: string, timeoutMs?: number }
 */

interface DelayEntry {
    name: string;        // tag server (o host:port per TCP dial)
    host: string;
    delayMs: number | null;
    ok: boolean;
    via: "clash" | "tcp";
}

const CLASH_BASE = (): string => {
    const port = process.env.CLASH_API_PORT || 9090;
    // DNS interno docker compose → container sing-box
    return `http://sing-box:${port}`;
};

async function testOneClash(name: string, timeoutMs: number): Promise<{ delayMs: number | null; ok: boolean }> {
    const url = `${CLASH_BASE()}/proxies/${encodeURIComponent(name)}/delay?timeout=${timeoutMs}&url=http%3A%2F%2Fwww.gstatic.com%2Fgenerate_204`;
    try {
        const res = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(timeoutMs + 1500) });
        if (!res.ok) return { delayMs: null, ok: false };
        const data = (await res.json()) as { delay?: number };
        return { delayMs: typeof data.delay === "number" ? data.delay : null, ok: true };
    } catch {
        return { delayMs: null, ok: false };
    }
}

/** TCP connect diretto a host:port (per voci NON attive, fuori dalla config sing-box). */
function tcpDelay(host: string, port: number, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = net.createConnection({ host, port });
        const done = (v: number | null) => { socket.destroy(); resolve(v); };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(Date.now() - start));
        socket.once("timeout", () => done(null));
        socket.once("error", () => done(null));
    });
}

/** Lista dei tag outbound presenti nella config sing-box corrente (via Clash API). */
async function listClashProxies(): Promise<string[]> {
    try {
        const res = await fetch(`${CLASH_BASE()}/proxies`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (!res.ok) return [];
        const data = (await res.json()) as { proxies?: Record<string, unknown> };
        return Object.keys(data.proxies ?? {});
    } catch {
        return [];
    }
}

export async function POST(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    let body: { serverId?: string; timeoutMs?: number } = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const timeoutMs = Math.min(5000, Math.max(500, Number(body.timeoutMs) || 2000));

    const store = await loadUserVpnStore(auth.userId);
    if (store.servers.length === 0) {
        return NextResponse.json({ ok: true, results: [], message: "Nessun server configurato" });
    }

    const targets = body.serverId
        ? store.servers.filter((s) => s.id === body.serverId)
        : store.servers;

    if (targets.length === 0) {
        return NextResponse.json({ ok: false, error: "Server non trovato" }, { status: 404 });
    }

    // I proxy `u{userId}-*` nella config corrente appartengono alla voce ATTIVA.
    const tagPrefix = `u${auth.userId}-`;
    const clashProxies = (await listClashProxies()).filter((n) => n.startsWith(tagPrefix));

    const allResults: { serverId: string; results: DelayEntry[] }[] = [];
    for (const server of targets) {
        const isActive = server.id === store.activeId;

        if (isActive && clashProxies.length > 0) {
            // Voce attiva: usa la Clash API sui tag REALI (dedup inclusi).
            const tasks = await Promise.all(
                clashProxies.map(async (n) => {
                    const r = await testOneClash(n, timeoutMs);
                    // host mostrato: strip prefix + strip suffisso dedup " #N"
                    const host = n.slice(tagPrefix.length).replace(/ #\d+$/, "");
                    return { name: n, host, delayMs: r.delayMs, ok: r.ok, via: "clash" as const } as DelayEntry;
                })
            );
            allResults.push({ serverId: server.id, results: tasks });
            continue;
        }

        // Voce NON attiva (o clash API irraggiungibile): TCP dial diretto.
        let resolved = server.resolvedServers ?? [];
        if (resolved.length === 0) {
            try { resolved = await resolveEntryServers(server); } catch { resolved = []; }
        }
        const tasks = await Promise.all(
            resolved
                .filter((s) => s.transport !== "xhttp")
                .map(async (s) => {
                    const delayMs = await tcpDelay(s.host, s.port, timeoutMs);
                    return {
                        name: s.tag || `${s.host}:${s.port}`,
                        host: s.tag || `${s.host}:${s.port}`,
                        delayMs,
                        ok: delayMs !== null,
                        via: "tcp" as const,
                    } as DelayEntry;
                })
        );
        allResults.push({ serverId: server.id, results: tasks });
    }

    // Salva l'ultimo delay test su ogni entry toccata
    for (const item of allResults) {
        const s = store.servers.find((x) => x.id === item.serverId);
        if (!s) continue;
        const okCount = item.results.filter((r) => r.ok).length;
        const delays = item.results.filter((r) => r.delayMs !== null).map((r) => r.delayMs as number);
        const avg = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;
        s.lastDelayTest = {
            at: new Date().toISOString(),
            avgDelayMs: avg,
            okCount,
            totalCount: item.results.length,
            samples: item.results
                .filter((r) => r.delayMs !== null)
                .map((r) => ({ host: r.host, delayMs: r.delayMs as number }))
                .sort((a, b) => a.delayMs - b.delayMs)
                .slice(0, 20),
        };
    }
    await saveUserVpnStore(auth.userId, store);

    // Appiattisci per il client, ordinato per delay crescente
    const flat: { serverId: string; label: string; delayMs: number | null; host: string; via: string }[] = [];
    for (const item of allResults) {
        const server = store.servers.find((s) => s.id === item.serverId);
        for (const r of item.results) {
            flat.push({ serverId: item.serverId, label: server?.label ?? "", host: r.host, delayMs: r.delayMs, via: r.via });
        }
    }
    flat.sort((a, b) => (a.delayMs ?? 1e9) - (b.delayMs ?? 1e9));

    return NextResponse.json({ ok: true, results: flat });
}