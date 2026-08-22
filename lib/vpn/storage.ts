import { promises as fs } from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// Storage persistente per la configurazione VPN/proxy.
// La directory di default è /app/.data/vpn/ (volume condiviso).

const VPN_DIR = process.env.VPN_DATA_DIR || '/app/.data/vpn';
const CREDS_FILE = path.join(VPN_DIR, 'creds.enc');

// Derivazione chiave da KEY_SECRET (32 byte per AES-256)
function getKey(): Buffer {
    const secret = process.env.KEY_SECRET;
    if (!secret) {
        throw new Error('KEY_SECRET not set');
    }
    return scryptSync(secret, 'paramount-stremio-vpn-salt', 32);
}

async function ensureDir(): Promise<void> {
    await fs.mkdir(VPN_DIR, { recursive: true, mode: 0o700 });
}

/** Cifra e salva un oggetto credenziali (mai loggarlo!). */
export async function saveCreds(creds: Record<string, any>): Promise<void> {
    await ensureDir();
    const key = getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plain = JSON.stringify(creds);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Formato: iv (12) | tag (16) | ciphertext
    const payload = Buffer.concat([iv, tag, enc]);
    await fs.writeFile(CREDS_FILE, payload, { mode: 0o600 });
}

/** Legge e decifra le credenziali. Ritorna null se non esiste. */
export async function loadCreds<T = Record<string, any>>(): Promise<T | null> {
    try {
        const buf = await fs.readFile(CREDS_FILE);
        if (buf.length < 28) return null;
        const key = getKey();
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const data = buf.subarray(28);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(data), decipher.final()]);
        return JSON.parse(plain.toString('utf8')) as T;
    } catch (err: any) {
        if (err?.code === 'ENOENT') return null;
        throw err;
    }
}

export async function deleteCreds(): Promise<void> {
    try {
        await fs.unlink(CREDS_FILE);
    } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err;
    }
}

export async function credsExist(): Promise<boolean> {
    try {
        await fs.access(CREDS_FILE);
        return true;
    } catch {
        return false;
    }
}

export const VPN_DATA_PATHS = {
    dir: VPN_DIR,
    credsFile: CREDS_FILE,
    wireguardConf: path.join(VPN_DIR, 'wireguard', 'proton.conf'),
    gluetunEnv: path.join(VPN_DIR, 'gluetun.env'),
};
