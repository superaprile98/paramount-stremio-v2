import { NextRequest, NextResponse } from "next/server";
import { fetchSubscription } from "@/lib/vpn/singbox";
import { writeMultiUserSingBoxConfig, type MultiUserEntry } from "@/lib/vpn/singbox";
import { parseShareLink, parseConfigText, type ParsedServer } from "@/lib/vpn/share-links";
import { requireConfigureUser } from "@/lib/auth/configure-auth";
import { loadUserVpnStore, saveUserVpnStore } from "@/lib/vpn/user-storage";
import { allocateUserPort, getAllUserPorts } from "@/lib/vpn/user-proxy";

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

    const store = await loadUserVpnStore(auth.userId);
    const entry = store.servers.find((s) => s.id === id);
    if (!entry) return NextResponse.json({ ok: false, error: "voce non trovata" }, { status: 404 });

    try {
        // 1) Risolve i server della voce selezionata (con cache sull'entry)
        let servers: ParsedServer[] = entry.resolvedServers ?? [];
        if (servers.length === 0) {
            if (entry.kind === "shareLink") {
                const parsed = parseShareLink(entry.input);
                if (!parsed) return NextResponse.json({ ok: false, error: "Share-link non valido" }, { status: 400 });
                servers = [parsed];
            } else if (entry.kind === "rawConfig") {
                servers = parseConfigText(entry.input);
                if (servers.length === 0) {
                    return NextResponse.json({ ok: false, error: "Config non valida: nessun server riconosciuto" }, { status: 400 });
                }
            } else {
                servers = await fetchSubscription(entry.input);
            }
            if (servers.length === 0) {
                return NextResponse.json({ ok: false, error: "Nessun server valido trovato" }, { status: 400 });
            }
        }

        // 2) Salva la voce attiva con i server risolti (cifrati a riposo)
        entry.resolvedServers = servers;
        store.activeId = entry.id;
        await saveUserVpnStore(auth.userId, store);

        // 3) Rigenera la config multi-tenant per TUTTI gli utenti con tunnel attivo
        allocateUserPort(auth.userId);
        const ports = getAllUserPorts();
        const entries: MultiUserEntry[] = [];
        for (const [uid] of Object.entries(ports)) {
            const userStore = await loadUserVpnStore(uid);
            const active = userStore.servers.find((s) => s.id === userStore.activeId);
            if (!active?.resolvedServers?.length) continue;
            entries.push({
                userId: uid,
                port: ports[uid],
                servers: active.resolvedServers,
                serverTag: active.serverTag,
            });
        }
        if (!entries.some((e) => e.userId === auth.userId)) {
            return NextResponse.json({ ok: false, error: "Errore interno: voce non inclusa nella config" }, { status: 500 });
        }
        const { configPath } = await writeMultiUserSingBoxConfig(entries);

        return NextResponse.json({
            ok: true,
            message: `Attivato "${entry.label}" (inbound dedicato). ${entries.length} tunnel attivi. sing-box si riavvierà entro ~5s.`,
            activeId: entry.id,
            serverCount: servers.length,
            activeTunnels: entries.length,
            configPath,
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
    }
}