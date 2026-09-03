import { NextRequest, NextResponse } from "next/server";
import { requireConfigureUser } from "@/lib/auth/configure-auth";
import {
    loadUserVpnStore,
    saveUserVpnStore,
    newServerId,
    type VpnServerEntry,
} from "@/lib/vpn/user-storage";
import { resolveEntryServers } from "@/lib/vpn/reconfigure";

/**
 * API lista VLESS per-utente (protetta da middleware + verifica cookie).
 *
 * GET            → { servers: [{id,label,kind,serverTag,addedAt}], activeId }
 *                  (l'input NON viene restituito in chiaro)
 * POST           → aggiunge { label, kind, input, serverTag? }
 * DELETE ?id=... → rimuove la voce (se era attiva, activeId → null)
 */

const MAX_SERVERS = 20;

function maskInput(entry: VpnServerEntry) {
    return {
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        serverTag: entry.serverTag,
        addedAt: entry.addedAt,
        lastSpeedTest: entry.lastSpeedTest ?? null,
        lastDelayTest: entry.lastDelayTest ?? null,
    };
}

export async function GET(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // GET ?id=... → lista NODI della voce (tag/host/port/protocollo, senza
    // segreti) per il selettore "auto | nodo specifico" nella UI.
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
        const store = await loadUserVpnStore(auth.userId);
        const entry = store.servers.find((s) => s.id === id);
        if (!entry) return NextResponse.json({ ok: false, error: "voce non trovata" }, { status: 404 });
        let nodes: { tag: string; host: string; port: number; protocol: string }[] = [];
        try {
            const resolved = await resolveEntryServers(entry);
            nodes = resolved
                .filter((s) => s.transport !== "xhttp")
                .map((s) => ({ tag: s.tag || `${s.host}:${s.port}`, host: s.host, port: s.port, protocol: s.protocol }));
            // cache per non rifare il fetch ad ogni apertura
            if (entry.resolvedServers?.length === 0 || !entry.resolvedServers) {
                entry.resolvedServers = resolved;
                await saveUserVpnStore(auth.userId, store);
            }
        } catch { /* subscription irraggiungibile: lista vuota */ }
        return NextResponse.json({ ok: true, id, serverTag: entry.serverTag, nodes });
    }

    const store = await loadUserVpnStore(auth.userId);
    return NextResponse.json({
        servers: store.servers.map(maskInput),
        activeId: store.activeId,
    });
}

export async function POST(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const label = String((body as any)?.label || "").trim() || "VLESS";
    const kind = String((body as any)?.kind || "").trim();
    const input = String((body as any)?.input || "").trim();
    const serverTag = String((body as any)?.serverTag || "auto").trim() || "auto";

    if (!["subscription", "shareLink", "rawConfig"].includes(kind)) {
        return NextResponse.json({ ok: false, error: "kind deve essere subscription | shareLink | rawConfig" }, { status: 400 });
    }
    if (!input) {
        return NextResponse.json({ ok: false, error: "input mancante" }, { status: 400 });
    }
    if (kind === "subscription" && !/^https?:\/\//i.test(input)) {
        return NextResponse.json({ ok: false, error: "subscription deve essere un URL http(s)" }, { status: 400 });
    }

    const store = await loadUserVpnStore(auth.userId);
    if (store.servers.length >= MAX_SERVERS) {
        return NextResponse.json({ ok: false, error: `Limite di ${MAX_SERVERS} server raggiunto` }, { status: 400 });
    }

    const entry: VpnServerEntry = {
        id: newServerId(),
        label,
        kind: kind as VpnServerEntry["kind"],
        input,
        serverTag,
        addedAt: new Date().toISOString(),
    };
    store.servers.push(entry);
    if (!store.activeId) store.activeId = entry.id;
    await saveUserVpnStore(auth.userId, store);

    return NextResponse.json({ ok: true, id: entry.id, servers: store.servers.map(maskInput), activeId: store.activeId });
}

export async function DELETE(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "id mancante" }, { status: 400 });

    const store = await loadUserVpnStore(auth.userId);
    const before = store.servers.length;
    store.servers = store.servers.filter((s) => s.id !== id);
    if (store.servers.length === before) {
        return NextResponse.json({ ok: false, error: "voce non trovata" }, { status: 404 });
    }
    if (store.activeId === id) store.activeId = store.servers[0]?.id ?? null;
    await saveUserVpnStore(auth.userId, store);

    return NextResponse.json({ ok: true, servers: store.servers.map(maskInput), activeId: store.activeId });
}