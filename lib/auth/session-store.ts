/**
 * Session store: mappa token corti (12-char hex) a session JWE key.
 * Risolve il problema del pulsante "Install in Stremio" che fallisce
 * con URL troppo lunghi (JWE ~1-2KB base64).
 *
 * Il token corto viene usato nell'URL pubblico (/api/install/<token>),
 * che fa 302 redirect al manifest.json reale.
 *
 * Persistenza: file JSON su disco (volume Docker) con fallback in-memory.
 * I token scadono dopo 7 giorni (stessa finestra della session JWE).
 */
import fs from "fs";
import path from "path";

const STORE_DIR = process.env.SESSION_STORE_DIR || path.join(process.cwd(), ".data", "sessions");
const STORE_FILE = path.join(STORE_DIR, "install-tokens.json");
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

// Fallback in-memory
const memoryStore = new Map<string, { key: string; expiresAt: number }>();

function ensureDir() {
    try {
        fs.mkdirSync(STORE_DIR, { recursive: true });
    } catch { /* filesystem non scrivibile */ }
}

function readAll(): Record<string, { key: string; expiresAt: number }> {
    try {
        ensureDir();
        if (fs.existsSync(STORE_FILE)) {
            const raw = fs.readFileSync(STORE_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
        }
    } catch { /* fallback */ }
    return {};
}

function writeAll(all: Record<string, { key: string; expiresAt: number }>) {
    try {
        ensureDir();
        fs.writeFileSync(STORE_FILE, JSON.stringify(all, null, 2), "utf-8");
    } catch { /* filesystem non scrivibile */ }
}

/** Genera un token corto (12 caratteri hex = 48 bit di entropia). */
function generateToken(): string {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Salva una session JWE key e restituisce un token corto. */
export function storeSessionKey(jweKey: string): string {
    const token = generateToken();
    const entry = { key: jweKey, expiresAt: Date.now() + TOKEN_TTL_MS };

    const all = readAll();
    // Pulizia token scaduti
    for (const [t, e] of Object.entries(all)) {
        if (Date.now() > e.expiresAt) delete all[t];
    }
    all[token] = entry;
    writeAll(all);
    memoryStore.set(token, entry);

    return token;
}

/** Recupera la JWE key associata a un token. Restituisce null se scaduto o inesistente. */
export function getSessionKey(token: string): string | null {
    // Prova memoria
    const mem = memoryStore.get(token);
    if (mem && Date.now() <= mem.expiresAt) return mem.key;
    if (mem) memoryStore.delete(token);

    // Prova disco
    const all = readAll();
    const entry = all[token];
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        delete all[token];
        writeAll(all);
        return null;
    }
    // Promuovi in memoria
    memoryStore.set(token, entry);
    return entry.key;
}