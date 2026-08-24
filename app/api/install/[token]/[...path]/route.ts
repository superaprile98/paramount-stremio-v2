import { NextRequest, NextResponse } from "next/server";
import { getSessionKey } from "@/lib/auth/session-store";
import { GET as catalogGet } from "@/app/api/stremio/[key]/catalog/[type]/[id]/[[...extra]]/route";
import { GET as metaGet } from "@/app/api/stremio/[key]/meta/[type]/[[...id]]/route";
import { GET as streamGet } from "@/app/api/stremio/[key]/stream/[type]/[[...id]]/route";
import { GET as prefsGet, POST as prefsPost } from "@/app/api/stremio/[key]/prefs/route";
import { GET as hlsGet, HEAD as hlsHead } from "@/app/api/stremio/[key]/proxy/hls/route";
import { GET as segGet, HEAD as segHead } from "@/app/api/stremio/[key]/proxy/seg/route";
import { GET as licenseGet, POST as licensePost } from "@/app/api/stremio/[key]/proxy/license/route";

export const runtime = "nodejs";

/**
 * Catch-all per /api/install/<token>/<path...>
 *
 * Quando Stremio installa l'addon da /api/install/<token>/manifest.json,
 * usa /api/install/<token>/ come base URL per TUTTE le chiamate API
 * (catalog, meta, stream). Questa route risolve il token in jweKey e
 * invoca direttamente gli handler reali di /api/stremio/<jweKey>/...
 * (NextResponse.rewrite() non e' supportato negli app route handler).
 *
 * Gli URL dei proxy (hls/seg/license) generati dalla route stream sono
 * assoluti e puntano gia' a /api/stremio/<jweKey>/proxy/..., quindi non
 * passano da qui; li gestiamo comunque per robustezza.
 */
export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ token: string; path: string[] }> }
) {
    return handle(req, ctx, "GET");
}

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ token: string; path: string[] }> }
) {
    return handle(req, ctx, "POST");
}

export async function HEAD(
    req: NextRequest,
    ctx: { params: Promise<{ token: string; path: string[] }> }
) {
    return handle(req, ctx, "HEAD");
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    });
}

async function handle(
    req: NextRequest,
    ctx: { params: Promise<{ token: string; path: string[] }> },
    method: "GET" | "POST" | "HEAD"
) {
    const { token, path } = await ctx.params;

    if (!token || !/^[a-f0-9]{12}$/.test(token)) {
        return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const jweKey = getSessionKey(token);
    if (!jweKey) {
        return NextResponse.json({ error: "Token expired or not found" }, { status: 404 });
    }

    const [first, second, ...rest] = path;

    // catalog/[type]/[id]/[[...extra]]
    if (first === "catalog" && second && rest.length >= 0) {
        const id = rest[0];
        if (!id) return NextResponse.json({ error: "Missing catalog id" }, { status: 400 });
        if (method === "GET") {
            return catalogGet(req, {
                params: Promise.resolve({ key: jweKey, type: second, id, extra: rest.slice(1) }),
            });
        }
    }

    // meta/[type]/[[...id]]
    if (first === "meta" && second) {
        if (method === "GET") {
            return metaGet(req, {
                params: Promise.resolve({ key: jweKey, type: second, id: rest }),
            });
        }
    }

    // stream/[type]/[[...id]]
    if (first === "stream" && second) {
        if (method === "GET") {
            return streamGet(req, {
                params: Promise.resolve({ key: jweKey, type: second, id: rest }),
            });
        }
    }

    // prefs
    if (first === "prefs" && path.length === 1) {
        if (method === "GET") {
            return prefsGet(req, { params: Promise.resolve({ key: jweKey }) });
        }
        if (method === "POST") {
            return prefsPost(req, { params: Promise.resolve({ key: jweKey }) });
        }
    }

    // proxy/hls
    if (first === "proxy" && second === "hls" && path.length === 2) {
        if (method === "GET") return hlsGet(req, { params: Promise.resolve({ key: jweKey }) });
        if (method === "HEAD") return hlsHead(req, { params: Promise.resolve({ key: jweKey }) });
    }

    // proxy/seg
    if (first === "proxy" && second === "seg" && path.length === 2) {
        if (method === "GET") return segGet(req, { params: Promise.resolve({ key: jweKey }) });
        if (method === "HEAD") return segHead(req, { params: Promise.resolve({ key: jweKey }) });
    }

    // proxy/license
    if (first === "proxy" && second === "license" && path.length === 2) {
        if (method === "GET") return licenseGet(req, { params: Promise.resolve({ key: jweKey }) });
        if (method === "POST") return licensePost(req, { params: Promise.resolve({ key: jweKey }) });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
}