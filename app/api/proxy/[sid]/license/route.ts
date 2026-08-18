import { NextRequest, NextResponse } from "next/server";
import { extend } from "@/lib/http/sid";
import { httpClient } from "@/lib/http/client";
import { ParamountClient } from "@/lib/paramount/client";
import {
    buildCookieHeader,
    isAllowedUpstreamUrl,
    needsParamountAuth,
    PPLUS_BASE_URL,
    PPLUS_HEADER,
} from "@/lib/paramount/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    const { sid } = await ctx.params;

    const entry = extend(sid);
    if (!entry) return new NextResponse("Unknown sid", { status: 404 });

    // L'URL licenza può arrivare come parametro (riscritto dal manifest MPD)
    // oppure essere salvato nel sid (lsUrl del token Irdeto).
    const u = req.nextUrl.searchParams.get("u");
    let licenseUrl: string;
    if (u) {
        try {
            licenseUrl = Buffer.from(u, "base64url").toString("utf-8");
        } catch {
            return new NextResponse("Bad license url", { status: 400 });
        }
    } else if (entry.l) {
        licenseUrl = entry.l;
    } else {
        return new NextResponse("Missing license url", { status: 400 });
    }

    let url: URL;
    try {
        url = new URL(licenseUrl);
    } catch {
        return new NextResponse("Bad license url", { status: 400 });
    }

    if (!isAllowedUpstreamUrl(url)) {
        return new NextResponse("Forbidden upstream host", { status: 403 });
    }

    const challenge = await req.arrayBuffer();
    const challengeBuffer = Buffer.from(challenge);

    const client = new ParamountClient();
    await client.setSessionKey(entry.key);
    const session = client.getSession();

    const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "Accept": "*/*",
        "Content-Length": challengeBuffer.length.toString(),
        "User-Agent": await PPLUS_HEADER(),
    };

    if (needsParamountAuth(url.hostname)) {
        if (entry.t) headers["authorization"] = `Bearer ${entry.t}`;
        const cookie = buildCookieHeader(session?.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const { status, data } = await httpClient.post(url.toString(), challengeBuffer, {
        responseType: "arraybuffer",
        headers,
    });

    return new NextResponse(data, {
        status,
        headers: {
            "Content-Type": "application/octet-stream",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-dtp",
        },
    });
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-dtp",
            "Access-Control-Max-Age": "86400",
        },
    });
}