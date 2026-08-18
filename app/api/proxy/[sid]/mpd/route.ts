import { NextRequest, NextResponse } from "next/server";
import { extend } from "@/lib/http/sid";
import { httpClient } from "@/lib/http/client";
import { ParamountClient } from "@/lib/paramount/client";
import {
    buildCookieHeader,
    guessBaseUrl,
    isAllowedUpstreamUrl,
    needsParamountAuth,
    PPLUS_BASE_URL,
    PPLUS_HEADER,
} from "@/lib/paramount/utils";
import { rewriteMpd } from "@/lib/paramount/proxy/mpd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    const { sid } = await ctx.params;

    const entry = extend(sid);
    if (!entry?.u) return new NextResponse("Unknown sid", { status: 404 });

    let upstreamUrl: URL;
    try {
        upstreamUrl = new URL(entry.u);
    } catch {
        return new NextResponse("Bad upstream url", { status: 400 });
    }

    if (!isAllowedUpstreamUrl(upstreamUrl)) {
        return new NextResponse("Forbidden upstream host", { status: 403 });
    }

    const client = new ParamountClient();
    await client.setSessionKey(entry.key);
    const session = client.getSession();

    const headers: Record<string, string> = {
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        "user-agent": await PPLUS_HEADER(),
        accept: "application/dash+xml, application/xml, */*",
    };

    if (needsParamountAuth(upstreamUrl.hostname)) {
        if (entry.t) headers["authorization"] = `Bearer ${entry.t}`;
        const cookie = buildCookieHeader(session?.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const { status, data } = await httpClient.get(upstreamUrl.toString(), { headers });
    if (status >= 400) {
        return new NextResponse(`Upstream error ${status}`, { status });
    }

    const baseOrigin = guessBaseUrl(req);
    const rewritten = rewriteMpd({
        text: data.toString(),
        upstreamUrl,
        baseOrigin,
        sid,
    });

    return new NextResponse(rewritten, {
        status,
        headers: {
            "Content-Type": "application/dash+xml",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        },
    });
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    return GET(req, ctx);
}