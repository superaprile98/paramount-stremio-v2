import { NextRequest } from "next/server";
import { ParamountAuthStart, ParamountClient, ParamountSession } from "@/lib/paramount/client";
import { guessBaseUrl } from "@/lib/paramount/utils";
import { withCors, optionsCors } from "@/lib/stremio/cors";
import { storeSessionKey } from "@/lib/auth/session-store";
import { CONFIG_COOKIE, requireConfigureUser } from "@/lib/auth/configure-auth";

export function OPTIONS() { return optionsCors(); }

export async function POST(req: NextRequest) {
    const auth: ParamountAuthStart | null = await req.json().catch(() => null);

    if (!auth || typeof auth.createdAt !== "string") {
        return withCors(Response.json({ ok: false, error: "Invalid auth payload" }, { status: 400 }));
    }
    // createdAt è memorizzato come Date.now().toString() (millisecondi come stringa numerica):
    // Date.parse di una stringa numerica pura ritorna NaN in Node, quindi usiamo Number() esplicito.
    const createdAtMs = Number(auth.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
        return withCors(Response.json({ ok: false, error: "Invalid auth payload" }, { status: 400 }));
    }

    if (Date.now() - createdAtMs > 10 * 60 * 1000) {
        return withCors(Response.json({ ok: false, error: "Auth expired" }, { status: 400 }));
    }

    const client = new ParamountClient();
    const polled = await client.pollDeviceAuth(auth);

    if (!polled.ok || !polled.cookies) {
        return withCors(Response.json({ ok: false }));
    }

    const session: ParamountSession = {
        cookies: polled.cookies,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 365
    };
    // Se il login avviene da /configure, associa la sessione all'utente
    // configure (per il proxy sing-box dedicato multi-tenant).
    const configureUser = await requireConfigureUser(req);
    if (configureUser) session.owner = configureUser.userId;
    await client.setSession(session);
    const key = await client.getSessionKey();
    if (!key) {
        return withCors(Response.json({ ok: false, error: "Failed to create session key" }, { status: 500 }));
    }

    const base = guessBaseUrl(req);
    const manifestUrl = `${base}/api/stremio/${encodeURIComponent(key)}/manifest.json`;
    const installToken = storeSessionKey(key);
    const installUrl = `${base}/api/install/${installToken}/manifest.json`;

    return withCors(Response.json({ ok: true, manifestUrl, installToken, installUrl }));
}
