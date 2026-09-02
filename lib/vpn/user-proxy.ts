import fs from 'fs';
import path from 'path';
import { VPN_DATA_PATHS } from '@/lib/vpn/storage';

/**
 * Allocazione porte per il sing-box multi-tenant.
 *
 * Ogni utente configure con una VLESS attiva ha un inbound HTTP dedicato:
 *   user A → http://sing-box:8888
 *   user B → http://sing-box:8889
 *   ...
 *
 * La mappa userId → port è persistita in {VPN_DATA_DIR}/users/ports.json
 * così l'assegnazione è stabile tra i rebuild della config.
 */

const PORTS_FILE = path.join(VPN_DATA_PATHS.dir, 'users', 'ports.json');
const PORT_BASE = Number(process.env.SINGBOX_PORT_BASE || 8888);
const PORT_MAX = PORT_BASE + 100;

type PortMap = Record<string, number>;

let cache: { data: PortMap; loadedAt: number } | null = null;
const CACHE_TTL_MS = 3000;

function readPorts(): PortMap {
    if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.data;
    try {
        if (fs.existsSync(PORTS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(PORTS_FILE, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
                cache = { data: parsed as PortMap, loadedAt: Date.now() };
                return cache.data;
            }
        }
    } catch { /* fallback */ }
    cache = { data: {}, loadedAt: Date.now() };
    return cache.data;
}

function writePorts(map: PortMap): void {
    try {
        fs.mkdirSync(path.dirname(PORTS_FILE), { recursive: true, mode: 0o700 });
        fs.writeFileSync(PORTS_FILE, JSON.stringify(map, null, 2), { mode: 0o600 });
        cache = { data: map, loadedAt: Date.now() };
    } catch { /* filesystem non scrivibile */ }
}

/** Alloca (o ritorna) la porta inbound dedicata a un utente. */
export function allocateUserPort(userId: string): number {
    const map = readPorts();
    if (map[userId]) return map[userId];
    const used = new Set(Object.values(map));
    for (let p = PORT_BASE; p <= PORT_MAX; p++) {
        if (!used.has(p)) {
            map[userId] = p;
            writePorts(map);
            return p;
        }
    }
    throw new Error(`No free inbound ports in range ${PORT_BASE}-${PORT_MAX}`);
}

/** Rilascia la porta di un utente (es. dopo la cancellazione della lista VLESS). */
export function releaseUserPort(userId: string): void {
    const map = readPorts();
    if (map[userId]) {
        delete map[userId];
        writePorts(map);
    }
}

/** URL del proxy dedicato all'utente, o null se non ha un inbound attivo. */
export function getUserProxyUrl(userId: string): string | null {
    const port = readPorts()[userId];
    return port ? `http://sing-box:${port}` : null;
}

/** Mappa completa userId → port (per generare la config multi-tenant). */
export function getAllUserPorts(): PortMap {
    return { ...readPorts() };
}