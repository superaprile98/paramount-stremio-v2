import { NextRequest, NextResponse } from "next/server";
import { extend } from "@/lib/http/sid";
import { httpClient } from "@/lib/http/client";
import { ParamountClient } from "@/lib/paramount/client";
import {
    buildCookieHeader,
    copyRespHeaders,
    forwardHeaders,
    isAllowedUpstreamUrl,
    needsParamountAuth,
    PPLUS_BASE_URL,
    PPLUS_HEADER,
} from "@/lib/paramount/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Segment proxy per le playlist DVR: il sid contiene il template URL dei
 * segmenti del CDN (con placeholder {n}) e il token Irdeto; il numero del
 * segmento arriva come query param `n`.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    const { sid } = await ctx.params;

    const entry = extend(sid);
    if (!entry || !entry.u || !entry.u.includes("{n}")) {
        return new NextResponse("Unknown sid", { status: 404 });
    }

    const n = req.nextUrl.searchParams.get("n");
    if (!n || !/^\d{1,9}$/.test(n)) {
        return new NextResponse("Missing or invalid n", { status: 400 });
    }

    let upstreamUrl: URL;
    try {
        upstreamUrl = new URL(entry.u.replace("{n}", n));
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
        ...forwardHeaders(req),
    };
    headers["user-agent"] = await PPLUS_HEADER();
    if (req.headers.has("range")) {
        headers["range"] = req.headers.get("range")!;
    }

    if (needsParamountAuth(upstreamUrl.hostname)) {
        if (entry.t) headers["authorization"] = `Bearer ${entry.t}`;
        const cookie = buildCookieHeader(session?.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const method = req.method === "HEAD" ? "HEAD" : "GET";
    const { status, data: stream, headers: resHeaders } = await httpClient.get(upstreamUrl.toString(), {
        headers,
        responseType: "stream",
        validateStatus: (s: number) => s < 500,
        proxyUrl: client.getSessionProxyUrl() ?? undefined,
    } as any);

    const webStream = new ReadableStream({
        start(controller) {
            stream.on("data", (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk));
            });
            stream.on("end", () => {
                controller.close();
            });
            stream.on("error", (err: Error) => {
                controller.error(err);
            });
        },
        cancel() {
            stream.destroy();
        },
    });

    const outHeaders = copyRespHeaders(resHeaders);
    const pathname = upstreamUrl.pathname.toLowerCase();
    if (pathname.endsWith(".ts")) {
        outHeaders.set("Content-Type", "video/mp2t");
    } else if (pathname.endsWith(".m4s") || pathname.endsWith(".mp4")) {
        outHeaders.set("Content-Type", "video/mp4");
    } else if (pathname.endsWith(".m4a")) {
        outHeaders.set("Content-Type", "audio/mp4");
    }
    outHeaders.set("Allow", "GET, HEAD, OPTIONS");
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    outHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range");
    outHeaders.set("Cache-Control", "public, max-age=60, s-maxage=60");

    if (method === "HEAD") {
        return new NextResponse(null, { status, headers: outHeaders });
    }

    return new NextResponse(webStream, { status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}