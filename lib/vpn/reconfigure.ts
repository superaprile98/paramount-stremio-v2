import { writeMultiUserSingBoxConfig, fetchSubscription, type MultiUserEntry } from "@/lib/vpn/singbox";
import { parseShareLink, parseConfigText, type ParsedServer } from "@/lib/vpn/share-links";
import { allocateUserPort, getAllUserPorts } from "@/lib/vpn/user-proxy";
import { loadUserVpnStore, type VpnServerEntry } from "@/lib/vpn/user-storage";

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

/**
 * Risolve i ParsedServer di una voce salvata (condiviso da vpn-switch e
 * vpn-delaytest): shareLink/rawConfig vengono parsati localmente, le
 * subscription vengono scaricate. NON tocca lo store: la cache va salvata
 * dal chiamante se serve.
 */
export async function resolveEntryServers(entry: VpnServerEntry): Promise<ParsedServer[]> {
    if (entry.resolvedServers?.length) return entry.resolvedServers;
    if (entry.kind === "shareLink") {
        const parsed = parseShareLink(entry.input);
        return parsed ? [parsed] : [];
    }
    if (entry.kind === "rawConfig") return parseConfigText(entry.input);
    return fetchSubscription(entry.input);
}