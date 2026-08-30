
import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
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
import type { SportEvent } from "@/lib/paramount/types/sport-models";
import { resolveLiveStream } from "@/lib/paramount/types/live";
import { resolveVodStream } from "@/lib/paramount/types/vod";
import { shorten } from "@/lib/http/sid";
import { httpClient } from "@/lib/http/client";
import { splitMasterPlaylist, splitAudioTracks } from "@/lib/paramount/proxy/hls"

export const runtime = "nodejs";
export const preferredRegion = "iad1";

// Cache breve del master manifest (P12): evita il doppio fetch quando il player
// richiede subito lo stesso master via /proxy/hls dopo la generazione delle varianti.
const MASTER_CACHE_TTL = 30 * 1000;
const masterCache = new Map<string, { data: string; expiresAt: number }>();

async function fetchMasterManifest(url: string, headers: Record<string, string>): Promise<string | null> {
    const cacheKey = `${url}|${headers["authorization"] ?? ""}`;
    const cached = masterCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    const { status, data } = await httpClient.get(url, { headers });
    if (status !== 200) return null;

    const text = data.toString();
    masterCache.set(cacheKey, { data: text, expiresAt: Date.now() + MASTER_CACHE_TTL });
    return text;
}

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id?: string[] }> }
) {
    const { key, type, id } = await ctx.params;

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
    } else if (parsed.kind === "movie" || parsed.kind === "series") {
        streamData = await resolveVodStream(session, parsed.key);
    }
    if (!streamData) return NextResponse.json({ streams: [] }, { status: 200 });

    // Un evento è "live" solo se è un canale live o uno sport in corso:
    // replay e VOD con isLive:true causano loop/seek broken sui player.
    const isLiveEvent = parsed.kind === "live" || (parsed.kind === "sport" && sportEvent?.status === "live");

    const lsUrl = streamData.lsUrl ?? "";
    const lsSession = streamData.lsSession;
    const streamingUrl = new URL(streamData.streamingUrl);
    const streamingTitle = streamData.streamingTitle;
    const streams = [];

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

    // Proxy playlist endpoint
    if (streamingUrl) {
        const baseUrl = process.env.BASE_URL?.replace(/\/$/, '') ?? new URL(req.url).origin;

        if (streamingUrl.toString().includes('.m3u8')) {

            // Base proxy URL (immutable reference — clone per variante)
            const proxyBase = new URL(`${baseUrl}/api/stremio/${encodeURIComponent(key)}/proxy/hls`);
            proxyBase.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString('base64url'));
            proxyBase.searchParams.set("t", Buffer.from(lsSession.toString()).toString('base64url'));

            // Auto quality stream
            streams.push({
                name: "Paramount+",
                title: `${streamingTitle} \n🗣️ Auto \n🎞 HLS (Auto quality)`,
                url: proxyBase.toString(),
                isLive: isLiveEvent,
                notWebReady: false
            });

            // DVR "from start" per eventi sportivi live: il CDN conserva tutti i
            // segmenti numerati dell'evento, la route /proxy/dvr sintetizza una
            // playlist EVENT completa (dal segmento 0 al live edge).
            if (isLiveEvent && parsed.kind === "sport") {
                const dvrUrl = new URL(`${baseUrl}/api/stremio/${encodeURIComponent(key)}/proxy/dvr`);
                dvrUrl.searchParams.set("u", Buffer.from(streamingUrl.toString()).toString('base64url'));
                dvrUrl.searchParams.set("t", Buffer.from(lsSession.toString()).toString('base64url'));
                streams.push({
                    name: "Paramount+",
                    title: `${streamingTitle} \n⏪ From Start (DVR) \n🎞 HLS (Auto quality)`,
                    url: dvrUrl.toString(),
                    isLive: false,
                    notWebReady: false
                });
            }

            headers['accept'] = "application/vnd.apple.mpegurl, application/x-mpegURL, */*";
            const masterM3u8 = await fetchMasterManifest(streamingUrl.toString(), headers);
            if (masterM3u8) {
                const audioTracks = splitAudioTracks(masterM3u8);
                const multiLang = audioTracks.length >= 2;

                // Per-language Auto quality streams
                if (multiLang) {
                    for (const track of audioTracks) {
                        const lUrl = new URL(proxyBase.toString());
                        lUrl.searchParams.set("lang", track.language);
                        streams.push({
                            name: "Paramount+",
                            title: `${streamingTitle} \n🗣️ ${track.name} \n🎞 HLS (Auto quality)`,
                            url: lUrl.toString(),
                            isLive: isLiveEvent,
                            notWebReady: false
                        });
                    }
                }

                // Quality-specific streams
                for (const variant of splitMasterPlaylist(masterM3u8)) {
                    const qUrl = new URL(proxyBase.toString());
                    qUrl.searchParams.set("b", String(variant.bandwidth));
                    streams.push({
                        name: "Paramount+",
                        title: `${streamingTitle} \n🗣️ Auto \n🎞 HLS (${variant.quality})`,
                        url: qUrl.toString(),
                        isLive: isLiveEvent,
                        notWebReady: false
                    });

                    // Per-language quality streams
                    if (multiLang) {
                        for (const track of audioTracks) {
                            const lUrl = new URL(proxyBase.toString());
                            lUrl.searchParams.set("b", String(variant.bandwidth));
                            lUrl.searchParams.set("lang", track.language);
                            streams.push({
                                name: "Paramount+",
                                title: `${streamingTitle} \n🗣️ ${track.name} \n🎞 HLS (${variant.quality})`,
                                url: lUrl.toString(),
                                isLive: isLiveEvent,
                                notWebReady: false
                            });
                        }
                    }
                }
            }

        } else if (streamingUrl.toString().includes('.mpd')) {
            //MPD internal proxy stream
            const sid = shorten(key, streamingUrl.toString(), lsSession.toString(), lsUrl.toString());
            const internal = new URL(`${baseUrl}/api/proxy/${sid}/mpd`);
            const license = new URL(`${baseUrl}/api/proxy/${sid}/license`);

            if (internal) {
                streams.push({
                    name: "Paramount+",
                    title: `${streamingTitle} \n🎞 MPD`,
                    url: internal.toString(),
                    isLive: isLiveEvent,
                    notWebReady: true,
                    behaviorHints: {
                        configuration: {
                            drm: {
                                widevine: {
                                    licenseUrl: license.toString()
                                }
                            }
                        }
                    }
                });
            }
        }
    }

    return NextResponse.json({ streams }, {
        status: 200, headers: {
            "Allow": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
            "Content-Type": "application/json",
        }
    });
}
