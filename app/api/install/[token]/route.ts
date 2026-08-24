import { NextRequest, NextResponse } from "next/server";
import { getSessionKey } from "@/lib/auth/session-store";
import { guessBaseUrl } from "@/lib/paramount/utils";
import { ParamountClient } from "@/lib/paramount/client";
import { buildManifest } from "@/lib/stremio/manifest";

export const runtime = "nodejs";

/**
 * GET /api/install/<token>
 * Restituisce il manifest JSON Stremio direttamente (senza redirect).
 * La URL corta (~55 char) viene accettata da stremio:// deep link senza
 * troncamento e senza "Failed to fetch" causato dal 302 redirect.
 */
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    const { token } = await ctx.params;

    if (!token || !/^[a-f0-9]{12}$/.test(token)) {
        return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const jweKey = getSessionKey(token);
    if (!jweKey) {
        return NextResponse.json({ error: "Token expired or not found" }, { status: 404 });
    }

    // Carica la session Paramount+ e costruisce il manifest
    const client = new ParamountClient();
    await client.setSessionKey(jweKey);

    const session = client.getSession();
    if (!session) {
        return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const base = guessBaseUrl(req);
    const manifest = await buildManifest(session, base);

    return NextResponse.json(manifest, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
        },
    });
}