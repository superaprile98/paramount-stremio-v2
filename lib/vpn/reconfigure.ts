import { writeMultiUserSingBoxConfig, type MultiUserEntry } from "@/lib/vpn/singbox";
import { allocateUserPort, getAllUserPorts } from "@/lib/vpn/user-proxy";
import { loadUserVpnStore } from "@/lib/vpn/user-storage";

/**
 * Helper condiviso da /api/configure/vpn-switch, /api/configure/vpn-servers
 * (e in futuro da /api/configure/free-sources) per rigenerare la config
 * sing-box multi-tenant dopo una modifica allo store di un utente.
 *
 * Strategia: per ogni utente che ha un tunnel attivo (activeId + resolvedServers)
 * aggiungo una entry MultiUserEntry; il file config.json viene riscritto
 * atomicamente e il watcher systemd riavvia sing-box.
 */

export interface ReconfigureResult {
    activeTunnels: number;
    configPath: string;
}

export async function reconfigureAllVpns(): Promise<ReconfigureResult> {
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
    const { configPath } = await writeMultiUserSingBoxConfig(entries);
    return { activeTunnels: entries.length, configPath };
}

/** Garantisce che l'utente abbia una porta allocata (idempotente). */
export function ensureUserPort(userId: string): number {
    return allocateUserPort(userId);
}