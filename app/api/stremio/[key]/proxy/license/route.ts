import { NextRequest, NextResponse } from "next/server";
import { httpClient } from "@/lib/http/client";
import { ParamountClient } from "@/lib/paramount/client";
import { PPLUS_HEADER, isAllowedUpstreamUrl, needsParamountAuth, buildCookieHeader, PPLUS_BASE_URL } from "@/lib/paramount/utils";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Decodifica e valida l'URL upstream dal parametro `u` (base64url).
 * Restituisce l'URL oppure una NextResponse di errore.
 */
function decodeUpstreamUrl(req: NextRequest): { url: URL | null; error: NextResponse | null } {
    const licenseUrl = req.nextUrl.searchParams.get("u");
    if (!licenseUrl) return { url: null, error: new NextResponse("Missing License URL", { status: 400 }) };

    let decodedUrl: string;
    try {
        decodedUrl = Buffer.from(licenseUrl, 'base64url').toString('utf-8');
    } catch {
        return { url: null, error: new NextResponse("Bad License URL", { status: 400 }) };
    }

    let url: URL;
    try {
        url = new URL(decodedUrl);
    } catch {
        return { url: null, error: new NextResponse("Bad License URL", { status: 400 }) };
    }

    if (!isAllowedUpstreamUrl(url)) {
        return { url: null, error: new NextResponse("Forbidden upstream host", { status: 403 }) };
    }

    return { url, error: null };
}

/**
 * GET — chiavi AES-128 HLS.
 * I player HLS recuperano la chiave di decifratura con una GET semplice
 * (niente challenge Widevine). Senza questo handler il player riceve 405
 * e resta in un loop di retry su /proxy/hls senza mai richiedere i segmenti.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const { url, error } = decodeUpstreamUrl(req);
    if (error) return error;

    const headers: Record<string, string> = {
        "Accept": "*/*",
        "User-Agent": await PPLUS_HEADER(),
    };

    if (needsParamountAuth(url!.hostname)) {
        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const { status, data } = await httpClient.get(url!.toString(), {
        responseType: 'arraybuffer',
        headers,
    });

    return new NextResponse(data, {
        status,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
            'Access-Control-Allow-Origin': '*',
        }
    });
}

/**
 * POST — challenge Widevine (DRM DASH/MPD).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const { url, error } = decodeUpstreamUrl(req);
    if (error) return error;

    const challenge = await req.arrayBuffer();
    const challengeBuffer = Buffer.from(challenge);

    const userAgent = await PPLUS_HEADER();
    const { status: status, data: data } = await httpClient.post(url!.toString(),
        challengeBuffer,
        {
            responseType: 'arraybuffer',
            headers: {
                "Content-Type": "application/octet-stream",
                "Accept": "*/*",
                "Content-Length": challengeBuffer.length.toString(),
                "User-Agent": userAgent,
                ...(session?.cookies?.length ? { Cookie: session.cookies.map((c) => c.split(";")[0]).join("; ") } : {}),
            },
        });

    return new NextResponse(data, {
        status: status,
        headers: {
            'Content-Type': 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
        }
    });
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-dtp',
            'Access-Control-Max-Age': '86400',
        },
    });
}