import { promises as fs } from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { VPN_DATA_PATHS } from '@/lib/vpn/storage';
import type { ParsedServer } from '@/lib/vpn/share-links';
import type { SpeedTestResult } from '@/lib/vpn/speedtest';

/**
 * Storage per-utente della lista VLESS (cifrato AES-256-GCM con KEY_SECRET).
 *
 * Ogni utente autenticato su /configure ha la sua directory:
 *   {VPN_DATA_DIR}/users/{userId}/vpn-servers.enc
 *
 * Nota: il file contiene gli input (subscription URL / share-link / rawConfig)
 * cifrati a riposo; la config attiva di sing-box resta quella globale
 * ({VPN_DATA_DIR}/sing-box/config.json) gestita da writeSingBoxConfig().
 */

export interface VpnServerEntry {
    id: string;
    label: string;
    kind: 'subscription' | 'shareLink' | 'rawConfig';
    /** URL subscription, share-link (vless://...) o JSON Xray. */
    input: string;
    serverTag: string;
    addedAt: string;
    /** Server risolti (cache): evita di rifare il fetch della subscription a ogni switch. */
    resolvedServers?: ParsedServer[];
    /** Ultimo speed test eseguito sulla voce (solo se attiva). */
    lastSpeedTest?: SpeedTestResult;
}

export interface UserVpnStore {
    servers: VpnServerEntry[];
    activeId: string | null;
}

function userDir(userId: string): string {
    return path.join(VPN_DATA_PATHS.dir, 'users', userId);
}

function userFile(userId: string): string {
    return path.join(userDir(userId), 'vpn-servers.enc');
}

function getKey(): Buffer {
    const secret = process.env.KEY_SECRET;
    if (!secret) throw new Error('KEY_SECRET not set');
    return scryptSync(secret, 'paramount-stremio-vpn-salt', 32);
}

async function ensureDir(userId: string): Promise<void> {
    await fs.mkdir(userDir(userId), { recursive: true, mode: 0o700 });
}

export async function loadUserVpnStore(userId: string): Promise<UserVpnStore> {
    try {
        const buf = await fs.readFile(userFile(userId));
        if (buf.length < 28) return { servers: [], activeId: null };
        const key = getKey();
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const data = buf.subarray(28);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(data), decipher.final()]);
        const parsed = JSON.parse(plain.toString('utf8')) as UserVpnStore;
        return {
            servers: Array.isArray(parsed.servers) ? parsed.servers : [],
            activeId: parsed.activeId ?? null,
        };
    } catch (err: any) {
        if (err?.code === 'ENOENT') return { servers: [], activeId: null };
        throw err;
    }
}

export async function saveUserVpnStore(userId: string, store: UserVpnStore): Promise<void> {
    await ensureDir(userId);
    const key = getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plain = JSON.stringify(store);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, enc]);
    await fs.writeFile(userFile(userId), payload, { mode: 0o600 });
}

export function newServerId(): string {
    return randomBytes(8).toString('hex');
}

/** Rimuove i dati VPN salvati di un utente (lista + activeId). */
export async function deleteUserVpnStore(userId: string): Promise<void> {
    try {
        await fs.rm(userDir(userId), { recursive: true, force: true });
    } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
    }
}