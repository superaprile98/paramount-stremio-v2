import { NextRequest, NextResponse } from "next/server";
import { getSessionKey } from "@/lib/auth/session-store";
import { guessBaseUrl } from "@/lib/paramount/utils";

export const runtime = "nodejs";

/**
 * GET /api/install/<token>
 * Redirect 302 al manifest.json Stremio usando il token corto.
 * Risolve il problema del deep link stremio:// con URL JWE troppo lunghi.
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

    const base = guessBaseUrl(req);
    const manifestUrl = `${base}/api/stremio/${encodeURIComponent(jweKey)}/manifest.json`;

    return NextResponse.redirect(manifestUrl, 302);
}