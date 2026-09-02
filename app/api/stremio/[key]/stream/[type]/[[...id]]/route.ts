import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { withCors } from "@/lib/stremio/cors";
import { parsePplusId } from "@/lib/paramount/mapping";
import {
    buildCookieHeader,
    needsParamountAuth,
    PPLUS_BASE_URL,
    PPLUS_HEADER,
    safeDecode,
    stripJsonSuffix
} from "@/lib/paramount/utils";
import { findSportEvent, resolveSportEventStream } from "@/lib/paramount/sports";
import type { SportEvent } from "@/lib/paramount/sport-models";
import { resolveLiveStream } from "@/lib/paramount/live";
import { httpClient } from "@/lib/http/client";
import { splitMasterPlaylist, splitAudioTracks, pickPreferredLang } from "@/lib/paramount/proxy/hls";
import { hlsStream, type AddonStream } from "@/lib/stremio/streams";

export const runtime = "nodejs";
export const preferredRegion = "iad1";

// Cache breve del master manifest (P12): evita il doppio fetch quando il player
// richiede subito lo stesso master via /proxy/hls dopo la generazione delle varianti.
const MASTER_CACHE_TTL = 30 * 1000;
const masterCache = new Map<string, { data: string; expiresAt: number }>();

async function fetchMasterManifest(
    url: string,
    headers: Record<string, string>,
    proxyUrl?: string
): Promise<string | null> {
    const cacheKey = `${url}|${headers["authorization"] ?? ""}`;
    const cached = masterCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    const { status, data } = await httpClient.get(url, { headers, proxyUrl } as any);
    if (status !== 200) return null;

    const text = data.toString();
    masterCache.set(cacheKey, { data: text, expiresAt: Date.now() + MASTER_CACHE_TTL });
    return text;
}

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id?: string[] }> }
) {
    const { key, id } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return NextResponse.json({ streams: [] }, { status: 200 });

    const cleaned = stripJsonSuffix(String(id));
    const decoded = safeDecode(cleaned);

    const parsed = parsePplusId(decoded);

    let streamData = null;
    let sportEvent: SportEvent | null = null;
    if (parsed.kind === "sport") {
        sportEvent = await findSportEvent(session, parsed.key);
        streamData = sportEvent ? await resolveSportEventStream(session, sportEvent) : null;
    } else if (parsed.kind === "live") {
        streamData = await resolveLiveStream(session, parsed.key);
    }
    if (!streamData) return NextResponse.json({ streams: [] }, { status: 200 });

    // Un evento è "live" solo se è un canale live o uno sport in corso:
    // con isLive:true su playlist finite i player vanno in loop/seek broken.
    const isLiveEvent = parsed.kind === "live" || (parsed.kind === "sport" && sportEvent?.status === "live");

    const lsSession = streamData.lsSession;
    const streamingUrl = new URL(streamData.streamingUrl);
    const streamingTitle = streamData.streamingTitle;
    const streams: AddonStream[] = [];

    const headers: Record<string, string> = {
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        "user-agent": await PPLUS_HEADER(),
    };
    if (needsParamountAuth(streamingUrl.hostname)) {
        headers["authorization"] = `Bearer ${lsSession}`;
        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const baseUrl = process.env.BASE_URL?.replace(/\/$/, "") ?? new URL(req.url).origin;

    if (streamingUrl.toString().includes(".m3u8")) {
        headers["accept"] = "application/vnd.apple.mpegurl, application/x-mpegURL, */*";
        const masterM3u8 = await fetchMasterManifest(streamingUrl.toString(), headers, client.getSessionProxyUrl() ?? undefined);
        const audioTracks = masterM3u8 ? splitAudioTracks(masterM3u8) : [];
        const multiLang = audioTracks.length >= 2;
        // Lingua preferita (ita → eng → DEFAULT → prima) anche con un solo
        // audio: senza `lang` il player potrebbe scegliere una traccia diversa.
        const preferredLang = audioTracks.length >= 1 ? pickPreferredLang(audioTracks) : null;
        const preferredTrack = preferredLang
            ? audioTracks.find((t) => t.language === preferredLang) ?? null
            : null;

        // Base proxy URL (immutable reference — clone per variante)
        const proxyBase = new URL(`${baseUrl}/api/stremio/${encodeURIComponent(key)}/proxy/hls`);
        proxyBase.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString("base64url"));
        proxyBase.searchParams.set("t", Buffer.from(lsSession.toString()).toString("base64url"));
        if (preferredLang) proxyBase.searchParams.set("lang", preferredLang);

        // Auto quality stream (con label lingua se nota, anche mono-audio)
        streams.push(
            hlsStream(
                `${streamingTitle} \n🗣️ ${preferredTrack?.name ?? "Auto"} \n🎞 HLS (Auto quality)`,
                proxyBase,
                isLiveEvent
            )
        );

        // DVR "from start" per eventi sportivi live: il CDN conserva tutti i
        // segmenti numerati dell'evento, la route /proxy/dvr sintetizza una
        // playlist EVENT completa (dal segmento 0 al live edge).
        if (isLiveEvent && parsed.kind === "sport") {
            const dvrUrl = new URL(`${baseUrl}/api/stremio/${encodeURIComponent(key)}/proxy/dvr`);
            dvrUrl.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString("base64url"));
            dvrUrl.searchParams.set("t", Buffer.from(lsSession.toString()).toString("base64url"));
            if (preferredLang) dvrUrl.searchParams.set("lang", preferredLang);
            streams.push(
                hlsStream(`${streamingTitle} \n⏪ From Start (DVR) \n🎞 HLS (Auto quality)`, dvrUrl, false)
            );
        }

        if (masterM3u8) {
            // Per-language Auto quality streams
            if (multiLang) {
                for (const track of audioTracks) {
                    const lUrl = new URL(proxyBase.toString());
                    lUrl.searchParams.set("lang", track.language);
                    streams.push(
                        hlsStream(`${streamingTitle} \n🗣️ ${track.name} \n🎞 HLS (Auto quality)`, lUrl, isLiveEvent)
                    );
                }
            }

            // Quality-specific streams (+ per-language)
            for (const variant of splitMasterPlaylist(masterM3u8)) {
                const qUrl = new URL(proxyBase.toString());
                qUrl.searchParams.set("b", String(variant.bandwidth));
                streams.push(
                    hlsStream(
                        `${streamingTitle} \n🗣️ ${preferredTrack?.name ?? "Auto"} \n🎞 HLS (${variant.quality})`,
                        qUrl,
                        isLiveEvent
                    )
                );

                if (multiLang) {
                    for (const track of audioTracks) {
                        const lUrl = new URL(proxyBase.toString());
                        lUrl.searchParams.set("b", String(variant.bandwidth));
                        lUrl.searchParams.set("lang", track.language);
                        streams.push(
                            hlsStream(
                                `${streamingTitle} \n🗣️ ${track.name} \n🎞 HLS (${variant.quality})`,
                                lUrl,
                                isLiveEvent
                            )
                        );
                    }
                }
            }
        }
    }

    return withCors(
        NextResponse.json(
            { streams },
            {
                status: 200,
                headers: {
                    "Allow": "GET, HEAD, OPTIONS",
                    "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
                },
            }
        )
    );
}
