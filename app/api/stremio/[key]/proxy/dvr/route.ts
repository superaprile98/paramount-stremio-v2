import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import {
    needsParamountAuth,
    isAllowedUpstreamUrl,
    buildCookieHeader,
    guessBaseUrl,
    PPLUS_BASE_URL,
    PPLUS_HEADER,
} from "@/lib/paramount/utils";
import { httpClient } from "@/lib/http/client";
import { shorten } from "@/lib/http/sid";
import { rewriteM3U8 } from "@/lib/paramount/proxy/hls";
import {
    parseMediaPlaylist,
    pickVariantUrl,
    pickVariant,
    pickAudioRenditions,
    pickAudioRendition,
    extractSegmentTemplate,
    buildDvrPlaylist,
    buildDvrMaster,
} from "@/lib/paramount/proxy/dvr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Il player ricarica la playlist ogni pochi secondi: cache di breve durata
// dell'output per limitare i fetch upstream (master + media playlist).
const DVR_CACHE_TTL = 4 * 1000;
const dvrCache = new Map<string, { body: string; expiresAt: number }>();

function m3u8Headers(): Headers {
    return new Headers({
        "Allow": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        "Content-Type": "application/vnd.apple.mpegurl",
    });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);
    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");
    const b = req.nextUrl.searchParams.get("b");
    const lang = req.nextUrl.searchParams.get("lang");
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    let upstreamUrl: URL;
    let rawToken: string;
    try {
        upstreamUrl = new URL(Buffer.from(u, "base64url").toString("utf-8"));
        rawToken = Buffer.from(t, "base64url").toString("utf-8");
    } catch {
        return new NextResponse("Bad upstream url or token", { status: 400 });
    }

    if (!isAllowedUpstreamUrl(upstreamUrl)) {
        return new NextResponse("Forbidden upstream host", { status: 403 });
    }

    const cacheKey = `${u}|${t}|${b ?? ""}|${lang ?? ""}`;
    const cached = dvrCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        return new NextResponse(cached.body, { status: 200, headers: m3u8Headers() });
    }

    const buildHeaders = async (hostname: string): Promise<Record<string, string>> => {
        const headers: Record<string, string> = {
            "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
            "user-agent": await PPLUS_HEADER(),
            accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        };
        if (needsParamountAuth(hostname)) {
            headers["authorization"] = `Bearer ${rawToken}`;
            const cookie = buildCookieHeader(session.cookies);
            if (cookie) headers["cookie"] = cookie;
            headers["origin"] = PPLUS_BASE_URL;
            headers["referer"] = PPLUS_BASE_URL;
        }
        return headers;
    };

    // Proxy dedicato dell'utente proprietario della sessione (multi-tenant)
    const sessionProxy = client.getSessionProxyUrl() ?? undefined;

    // 1) Fetch del playlist iniziale (master o media)
    const first = await httpClient.get(upstreamUrl.toString(), { headers: await buildHeaders(upstreamUrl.hostname), proxyUrl: sessionProxy } as any);
    if (first.status !== 200) return new NextResponse("Upstream error", { status: 502 });
    let text = first.data.toString();
    let mediaUrl = upstreamUrl;

    // 2) Se è un master, seleziona la variante e fetch della media playlist.
    //    Con rendition audio separate (#EXT-X-MEDIA:TYPE=AUDIO) ritorniamo un
    //    master DVR: video → playlist DVR video, audio → playlist DVR audio
    //    (le due playlist EVENT vengono poi servite da questa stessa route
    //    quando il player richiede i loro URL).
    if (text.includes("#EXT-X-STREAM-INF")) {
        const variant = pickVariant(text, upstreamUrl, b ? parseInt(b, 10) : null);
        if (!variant) return new NextResponse("No variants", { status: 502 });

        const renditions = pickAudioRenditions(text, upstreamUrl);
        const audio = pickAudioRendition(renditions, lang);

        if (audio) {
            const baseOrigin = guessBaseUrl(req);
            const dvrUrlFor = (upstream: URL) => {
                const d = new URL(`${baseOrigin}/api/stremio/${encodeURIComponent(key)}/proxy/dvr`);
                d.searchParams.set("u", Buffer.from(upstream.toString()).toString("base64url"));
                d.searchParams.set("t", t);
                return d.toString();
            };
            const videoPlaylistUrl = new URL(variant.url);
            const audioPlaylistUrl = new URL(audio.uri);
            const master = buildDvrMaster({
                variant,
                audio,
                videoPlaylistUrl: dvrUrlFor(videoPlaylistUrl),
                audioPlaylistUrl: dvrUrlFor(audioPlaylistUrl),
            });
            dvrCache.set(cacheKey, { body: master, expiresAt: Date.now() + DVR_CACHE_TTL });
            return new NextResponse(master, { status: 200, headers: m3u8Headers() });
        }

        // Nessuna rendition audio separata (muxed): comportamento precedente
        const variantUrl = pickVariantUrl(text, upstreamUrl, b ? parseInt(b, 10) : null);
        if (!variantUrl) return new NextResponse("No variants", { status: 502 });
        mediaUrl = new URL(variantUrl);
        const media = await httpClient.get(mediaUrl.toString(), { headers: await buildHeaders(mediaUrl.hostname), proxyUrl: sessionProxy } as any);
        if (media.status !== 200) return new NextResponse("Upstream error", { status: 502 });
        text = media.data.toString();
    }

    // 3) Parse della media playlist
    const parsed = parseMediaPlaylist(text, mediaUrl);
    const template = extractSegmentTemplate(parsed.segments);
    if (!template) {
        // Fallback: segmenti non numerati → restituisci la finestra live riscritta
        const rewritten = rewriteM3U8({
            text,
            upstreamUrl: mediaUrl,
            baseOrigin: guessBaseUrl(req),
            key,
            token: t,
        });
        return new NextResponse(rewritten, { status: 200, headers: m3u8Headers() });
    }

    // sid compatto per i segmenti: template + token Irdeto in cache in-process
    const sid = shorten(key, template, rawToken);

    const body = buildDvrPlaylist({
        parsed,
        template,
        sid,
        baseOrigin: guessBaseUrl(req),
        key,
        token: t,
    });

    // Prune della cache quando cresce
    if (dvrCache.size > 64) {
        const now = Date.now();
        for (const [k, v] of dvrCache) {
            if (now >= v.expiresAt) dvrCache.delete(k);
        }
    }
    dvrCache.set(cacheKey, { body, expiresAt: Date.now() + DVR_CACHE_TTL });

    return new NextResponse(body, { status: 200, headers: m3u8Headers() });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    const resp = await handle(req, ctx);
    return new NextResponse(null, { status: resp.status, headers: m3u8Headers() });
}