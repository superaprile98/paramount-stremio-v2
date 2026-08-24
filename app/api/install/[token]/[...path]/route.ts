import { NextRequest, NextResponse } from "next/server";
import { getSessionKey } from "@/lib/auth/session-store";

export const runtime = "nodejs";

/**
 * Catch-all per /api/install/<token>/<path...>
 *
 * Quando Stremio installa l'addon da /api/install/<token>/manifest.json,
 * usa /api/install/<token>/ come base URL per TUTTE le chiamate API
 * (catalog, meta, stream, proxy/*). Questa route risolve il token e
 * riscrive internamente la richiesta verso la vera route /api/stremio/<jweKey>/...
 */
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ token: string; path: string[] }> }
) {
    return handle(req, ctx);
}

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ token: string; path: string[] }> }
) {
    return handle(req, ctx);
}

export async function OPTIONS() {
    // CORS preflight pass-through
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    });
}

async function handle(
    req: NextRequest,
    ctx: { params: Promise<{ token: string; path: string[] }> }
) {
    const { token, path } = await ctx.params;

    if (!token || !/^[a-f0-9]{12}$/.test(token)) {
        return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const jweKey = getSessionKey(token);
    if (!jweKey) {
        return NextResponse.json({ error: "Token expired or not found" }, { status: 404 });
    }

    // Stremio appende .json ai path; rimuovilo dall'ultimo segmento
    const cleanSegments = path.map((seg, i) =>
        i === path.length - 1 ? seg.replace(/\.json$/, "") : seg
    );

    const targetPath = `/api/stremio/${encodeURIComponent(jweKey)}/${cleanSegments.join("/")}`;
    const qs = req.nextUrl.search;
    const fullUrl = qs ? `${targetPath}${qs}` : targetPath;

    return NextResponse.rewrite(new URL(fullUrl, req.url));
}