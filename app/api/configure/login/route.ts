import { NextRequest, NextResponse } from "next/server";
import {
    CONFIG_COOKIE,
    CONFIG_SESSION_TTL_MS,
    checkCredentials,
    createConfigureSessionToken,
    isConfigureAuthConfigured,
} from "@/lib/auth/configure-auth";

/**
 * POST /api/configure/login — body { username, password }.
 * Imposta il cookie di sessione HttpOnly (JWE, 30 giorni).
 */
export async function POST(req: NextRequest) {
    if (!isConfigureAuthConfigured()) {
        return NextResponse.json(
            { ok: false, error: "Configure auth non configurata: impostare CONFIG_CREDENTIALS (o CONFIG_USER/CONFIG_PASSWORD) in .env" },
            { status: 503 }
        );
    }

    const body = await req.json().catch(() => null);
    const username = String((body as any)?.username ?? "");
    const password = String((body as any)?.password ?? "");

    const user = checkCredentials(username, password);
    if (!user) {
        return NextResponse.json({ ok: false, error: "Credenziali non valide" }, { status: 401 });
    }

    const token = await createConfigureSessionToken(user);
    const res = NextResponse.json({ ok: true, user });
    res.cookies.set(CONFIG_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: Math.floor(CONFIG_SESSION_TTL_MS / 1000),
    });
    return res;
}