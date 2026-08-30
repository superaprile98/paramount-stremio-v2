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
export const revalidate = 0;

async function handle(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    const { sid } = await ctx.params;

    const entry = extend(sid);
    if (!entry) return new NextResponse("Unknown sid", { status: 404 });

    const u = req.nextUrl.searchParams.get("u");
    if (!u) return new NextResponse("Missing u", { status: 400 });

    // `s` contiene la parte di URL con i placeholder DASH GIÀ sostituiti dal
    // player (es. "42.m4s"): va concatenata al prefisso in `u`.
    const s = req.nextUrl.searchParams.get("s") ?? "";

    let upstreamUrl: URL;
    try {
        upstreamUrl = new URL(Buffer.from(u, "base64url").toString("utf-8") + s);
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
        validateStatus: (s) => s < 500,
    });

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

    const isMediaSegment =
        pathname.endsWith(".ts") || pathname.endsWith(".m4s") || pathname.endsWith(".mp4") || pathname.endsWith(".m4a");
    if (isMediaSegment) {
        outHeaders.set("Cache-Control", "public, max-age=60, s-maxage=60");
    } else {
        outHeaders.set("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate");
    }

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