import { NextRequest, NextResponse } from "next/server";
import { requireConfigureUser } from "@/lib/auth/configure-auth";
import { loadUserVpnStore, saveUserVpnStore } from "@/lib/vpn/user-storage";

/**
 * POST /api/configure/vpn-delaytest
 *
 * Misura il delay (latenza) di ciascun server VLESS dell'utente autenticato
 * interrogando la Clash API di sing-box (vedi experimental.clash_api in
 * lib/vpn/singbox.ts). Salva i risultati su UserVpnStore.lastDelayTest e
 * restituisce l'array ordinato per delay crescente (migliore → peggiore).
 *
 * Endpoint sing-box:
 *   POST http://sing-box:9090/proxies/{name}/delay?timeout=2000&url=...
 *
 * Body: { serverId: string, timeoutMs?: number }  // opzionale
 */

interface DelayEntry {
    name: string;        // tag server
    host: string;
    delayMs: number | null;
    ok: boolean;
}

const CLASH_BASE = (): string => {
    const port = process.env.CLASH_API_PORT || 9090;
    // DNS interno docker compose → container sing-box
    return `http://sing-box:${port}`;
};

async function testOne(name: string, timeoutMs: number): Promise<{ delayMs: number | null; ok: boolean }> {
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

    const allResults: { serverId: string; results: DelayEntry[] }[] = [];
    for (const server of targets) {
        const resolved = server.resolvedServers ?? [];
        const tagPrefix = `u${auth.userId}-`;
        const names = resolved
            .filter((s) => s.transport !== "xhttp")
            .map((s) => tagPrefix + (s.tag || `${s.host}:${s.port}`));
        const tasks = await Promise.all(
            names.map(async (n) => {
                const r = await testOne(n, timeoutMs);
                const host = n.startsWith(tagPrefix) ? n.slice(tagPrefix.length) : n;
                return { name: n, host, delayMs: r.delayMs, ok: r.ok } as DelayEntry;
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
                .slice(0, 5),
        };
    }
    await saveUserVpnStore(auth.userId, store);

    // Appiattisci per il client, ordinato per delay crescente
    const flat: { serverId: string; label: string; delayMs: number | null; host: string }[] = [];
    for (const item of allResults) {
        const server = store.servers.find((s) => s.id === item.serverId);
        for (const r of item.results) {
            flat.push({ serverId: item.serverId, label: server?.label ?? "", host: r.host, delayMs: r.delayMs });
        }
    }
    flat.sort((a, b) => (a.delayMs ?? 1e9) - (b.delayMs ?? 1e9));

    return NextResponse.json({ ok: true, results: flat });
}