import { NextRequest } from "next/server";
import { seal, unseal } from "@/lib/auth/jwe";

/**
 * Auth per la pagina /configure e le sue API.
 *
 * Credenziali da env (fail-closed: se non configurate, l'accesso è negato):
 * - CONFIG_CREDENTIALS: JSON map { "user1": "pass1", "user2": "pass2" }
 * - oppure singola coppia CONFIG_USER / CONFIG_PASSWORD
 *
 * L'username usato al login diventa l'identità per-utente (storage VLESS
 * separato per ciascun utente, vedi lib/vpn/user-storage.ts).
 */

export const CONFIG_COOKIE = "configure_session";
export const CONFIG_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 giorni

export interface ConfigureSession {
    u: string;
    exp: number;
}

export function isConfigureAuthConfigured(): boolean {
    if (process.env.CONFIG_CREDENTIALS) return true;
    return Boolean(process.env.CONFIG_USER && process.env.CONFIG_PASSWORD);
}

/** Mappa username → password dalle env. */
function credentialsMap(): Record<string, string> {
    const raw = process.env.CONFIG_CREDENTIALS;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
        } catch {
            // JSON invalido: fallback alla coppia singola
        }
    }
    const u = process.env.CONFIG_USER;
    const p = process.env.CONFIG_PASSWORD;
    return u && p ? { [u]: p } : {};
}

/** Confronto timing-safe di due stringhe. */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        // Consuma comunque un confronto per non leakare la lunghezza
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(a));
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Verifica le credenziali. Ritorna l'username se valide, null altrimenti.
 */
export function checkCredentials(username: string, password: string): string | null {
    const map = credentialsMap();
    if (Object.keys(map).length === 0) return null;
    const user = String(username || "").trim();
    const expected = map[user];
    if (!expected || !timingSafeEqual(String(password || ""), expected)) return null;
    return user;
}

/** Crea il token JWE di sessione per l'utente. */
export async function createConfigureSessionToken(username: string): Promise<string> {
    return seal({ u: username, exp: Date.now() + CONFIG_SESSION_TTL_MS } satisfies ConfigureSession);
}

/** Verifica il token del cookie. Ritorna la sessione o null. */
export async function verifyConfigureSession(token: string | undefined | null): Promise<ConfigureSession | null> {
    if (!token) return null;
    try {
        const payload = (await unseal(token)) as Partial<ConfigureSession>;
        if (typeof payload?.u !== "string" || typeof payload?.exp !== "number") return null;
        if (payload.exp <= Date.now()) return null;
        return { u: payload.u, exp: payload.exp };
    } catch {
        return null;
    }
}

/** Normalizza l'username per usarlo come nome di directory. */
export function sanitizeUserId(username: string): string {
    return username.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64) || "default";
}

/**
 * Helper per le API protette: verifica il cookie di sessione e ritorna
 * l'identità utente (userId sanitizzato) o null.
 */
export async function requireConfigureUser(req: NextRequest): Promise<{ userId: string; username: string } | null> {
    const session = await verifyConfigureSession(req.cookies.get(CONFIG_COOKIE)?.value);
    if (!session) return null;
    return { userId: sanitizeUserId(session.u), username: session.u };
}