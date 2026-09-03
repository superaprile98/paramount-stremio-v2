import { NextRequest, NextResponse } from "next/server";
import type { ParsedServer } from "@/lib/vpn/share-links";
import { requireConfigureUser } from "@/lib/auth/configure-auth";
import { loadUserVpnStore, saveUserVpnStore } from "@/lib/vpn/user-storage";
import { ensureUserPort, reconfigureAllVpns, resolveEntryServers } from "@/lib/vpn/reconfigure";

/**
 * POST /api/configure/vpn-switch — body { id }.
 *
 * Attiva la voce VLESS dell'utente e rigenera la config sing-box
 * multi-tenant: ogni utente con una VLESS attiva ha il proprio inbound
 * (porta dedicata) e il proprio gruppo outbound — l'egress NON è condiviso.
 *
 * Il watcher systemd osserva config.json e riavvia sing-box automaticamente.
 */
export async function POST(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const id = String((body as any)?.id || "");
    if (!id) return NextResponse.json({ ok: false, error: "id mancante" }, { status: 400 });
    // serverTag opzionale: "auto" (default) o il tag di un nodo specifico.
    const serverTag = String((body as any)?.serverTag || "").trim();

    const store = await loadUserVpnStore(auth.userId);
    const entry = store.servers.find((s) => s.id === id);
    if (!entry) return NextResponse.json({ ok: false, error: "voce non trovata" }, { status: 404 });

    try {
        // 1) Risolve i server della voce selezionata (con cache sull'entry)
        const servers: ParsedServer[] = await resolveEntryServers(entry);
        if (servers.length === 0) {
            return NextResponse.json({ ok: false, error: "Nessun server valido trovato (input non valido o subscription irraggiungibile)" }, { status: 400 });
        }

        // 2) Salva la voce attiva con i server risolti (cifrati a riposo)
        entry.resolvedServers = servers;
        if (serverTag) entry.serverTag = serverTag;
        store.activeId = entry.id;
        await saveUserVpnStore(auth.userId, store);

        // 3) Rigenera la config multi-tenant per TUTTI gli utenti con tunnel attivo
        ensureUserPort(auth.userId);
        const { activeTunnels, configPath } = await reconfigureAllVpns();

        return NextResponse.json({
            ok: true,
            message: `Attivato "${entry.label}" (inbound dedicato). ${activeTunnels} tunnel attivi. sing-box si riavvierà entro ~5s.`,
            activeId: entry.id,
            serverCount: servers.length,
            activeTunnels,
            configPath,
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
    }
}