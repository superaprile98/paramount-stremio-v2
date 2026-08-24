import { NextRequest } from "next/server";
import { ParamountClient, ParamountSession } from "@/lib/paramount/client";
import { guessBaseUrl } from "@/lib/paramount/utils";
import { withCors, optionsCors } from "@/lib/stremio/cors";

export function OPTIONS() { return optionsCors(); }

/**
 * Rate-limit in-memory per IP, anti IP-ban di Paramount+ (vedi 3052/rosso).
 * Manteniamo una sliding window di 15 minuti: massimo 5 tentativi falliti
 * per IP. I tentativi riusciti NON occupano slot (evita di bloccare l'utente
 * che effettua correttamente il login).
 */
type AttemptEntry = { ts: number; failed: boolean };
const attempts = new Map<string, AttemptEntry[]>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILED = 5;

function clientIp(req: NextRequest): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real;
    return "unknown";
}

function pruneAndCount(ip: string, isFailure: boolean): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const list = attempts.get(ip) ?? [];
    const recent = list.filter((e) => now - e.ts < RATE_WINDOW_MS);

    if (isFailure) recent.push({ ts: now, failed: true });
    attempts.set(ip, recent);

    const failedCount = recent.filter((e) => e.failed).length;
    if (failedCount <= RATE_MAX_FAILED) return { allowed: true };

    // Tempo al piu' vecchio fallimento + window
    const oldestFail = recent.filter((e) => e.failed)[0];
    const retryAfter = oldestFail ? Math.ceil((oldestFail.ts + RATE_WINDOW_MS - now) / 1000) : RATE_WINDOW_MS / 1000;
    return { allowed: false, retryAfter };
}

export async function POST(req: NextRequest) {
    const ip = clientIp(req);

    let body: any;
    try {
        body = await req.json();
    } catch {
        return withCors(Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 }));
    }

    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
        return withCors(Response.json({ ok: false, error: "Email and password required" }, { status: 400 }));
    }

    // Validazione basilare email (non bloccare simboli strani, ma evita input vuoti/iniettati)
    if (email.length > 254 || password.length > 1024) {
        return withCors(Response.json({ ok: false, error: "Input too long" }, { status: 400 }));
    }

    const rate = pruneAndCount(ip, false);
    if (!rate.allowed) {
        return withCors(Response.json(
            { ok: false, error: "Too many failed attempts. Try again later or use the device-code login." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } }
        ));
    }

    const client = new ParamountClient();
    const result = await client.loginWithPassword(email, password);

    if (!result.ok || !result.cookies) {
        // Aggiorna il rate-limit: solo i fallimenti contano
        pruneAndCount(ip, true);
        return withCors(Response.json({ ok: false, error: result.error ?? "Login failed" }, { status: 401 }));
    }

    const session: ParamountSession = {
        cookies: result.cookies,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365,
    };
    await client.setSession(session);
    const key = await client.getSessionKey();
    if (!key) {
        return withCors(Response.json({ ok: false, error: "Failed to create session key" }, { status: 500 }));
    }

    const base = guessBaseUrl(req);
    const manifestUrl = `${base}/api/stremio/${encodeURIComponent(key)}/manifest.json`;

    return withCors(Response.json({ ok: true, manifestUrl }));
}