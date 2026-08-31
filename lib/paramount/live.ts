import { ParamountClient, ParamountSession } from "@/lib/paramount/client";
import { StremioMeta } from "@/lib/stremio/types";
import { isLicenseUrl, normImg, pickManifestUrl, pickPoster, sessionFingerprint } from "@/lib/paramount/utils";
import { pplusLiveId } from "@/lib/paramount/mapping";
import { LiveChannelItem } from "@/lib/paramount/types/api";

export function mapLiveListingToMeta(e: LiveChannelItem | null | undefined) {
    const eventId = e?.slug;
    const channelName = e?.channelName;
    let channelTitle = channelName;
    if (!eventId || !channelName) return null;

    const channel = e?.channelName ?? e?.slug ?? "";
    const logo = normImg(e?.filePathLogo ?? e?.brand?.filePathLogo);

    const channelListing = e?.currentListing?.[0] ?? e?.upcomingListing?.[0] ?? null;
    const channelProgram = channelListing?.title ?? null;
    const channelProgramDesc = channelListing?.description ?? null;
    const channelProgramPoster = pickPoster(channelListing);
    if (channelProgram && channelProgram.toString().toLowerCase() !== channelName.toString().toLowerCase())
        channelTitle = `${channelName} — ${channelProgram}`

    const descParts: string[] = [];
    if (channel) descParts.push(`${channel}`);
    if (channelProgram && channel !== channelProgram) descParts.push(`${channelProgram}`);
    descParts.push("LIVE");
    if (channelProgramDesc) descParts.push(String(channelProgramDesc));
    if (e?.description) descParts.push(String(e.description));

    const genres = [
        'Paramount+',
        'Live',
    ];

    return {
        id: pplusLiveId(String(eventId)),
        type: "tv" as const,
        name: String(channelTitle),
        poster: channelProgramPoster,
        background: channelProgramPoster,
        logo: logo,
        posterShape: "landscape" as const,
        description: descParts.join(" • "),
        genres: genres,
    } as StremioMeta;
}

const LIVE_LISTING_CACHE_TTL = 30 * 1000;
// Cache per-sessione: la chiave è il fingerprint dei cookie, così tenant
// diversi non condividono mai i listing (fix cross-tenant).
const liveListingCache = new Map<string, { data: any[]; expiresAt: number }>();

export async function getLiveListing(session: ParamountSession): Promise<LiveChannelItem[]> {
    const cacheKey = sessionFingerprint(session);
    const cached = liveListingCache.get(cacheKey);
    let listings: LiveChannelItem[];

    if (cached && Date.now() < cached.expiresAt) {
        listings = cached.data;
    } else {
        const client = new ParamountClient();
        await client.setSession(session);
        const data = await client.getLiveChannels();

        listings = (data?.channels ??
            data?.data?.channels ??
            data?.data?.listings ??
            data?.data?.data?.listings ??
            []) as LiveChannelItem[];

        if (listings.length === 0) {
            console.warn("[live] empty listings, raw response:", JSON.stringify(data)?.slice(0, 500));
        } else {
            liveListingCache.set(cacheKey, { data: listings, expiresAt: Date.now() + LIVE_LISTING_CACHE_TTL });
        }
    }

    // Mostriamo TUTTI i canali live. In passato i canali `vod_to_live` venivano
    // nascosti perche' restituivano solo manifest MPD (DASH) non riproducibili
    // da Stremio web/desktop. Ora pickManifestUrl() preferisce HLS (.m3u8)
    // quando disponibile, quindi i canali vod_to_live tornano visibili: se il
    // token contiene HLS il flusso e' riproducibile, altrimenti ricade su MPD
    // (notWebReady, richiede player con Widevine CDM).
    return listings;
}

export async function findLiveListing(session: ParamountSession, slug: string) {
    const listings: any[] = await getLiveListing(session);
    return listings.find((x) => String(x?.slug) === String(slug)) ?? null;
}

export async function buildLiveMeta(session: ParamountSession, slug: string): Promise<StremioMeta> {
    const e = await findLiveListing(session, slug);
    return mapLiveListingToMeta(e) as StremioMeta;
}

export async function resolveLiveStream(session: ParamountSession, slug: string): Promise<{
    streamingUrl: string;
    streamingTitle: string;
    lsSession: string;
    lsUrl: string | undefined;
    videoContentId: string;
} | null> {
    const e = await findLiveListing(session, slug);
    const channelName = e?.channelName ?? slug;
    const channelProgram = e?.currentListing?.[0] ?? e?.upcomingListing?.[0] ?? null;
    let streamingTitle = `📺 ${channelName}`;
    if (channelProgram?.title && channelProgram?.title.toString().toLowerCase() !== channelName.toString().toLowerCase())
        streamingTitle += `\n📹 ${channelProgram?.title}`;
    const streamingContentId = channelProgram?.videoContentId ?? channelProgram?.contentId ?? e?.videoContentId ?? e?.contentId ?? null;

    const client = new ParamountClient();
    await client.setSession(session);
    const tokenResp = await client.getIrdetoSessionToken(String(streamingContentId));
    const streamingUrl = pickManifestUrl(tokenResp);
    const lsSession = tokenResp?.ls_session;
    const lsUrl = tokenResp?.url;

    if (!streamingUrl || !lsSession) return null;
    if (isLicenseUrl(streamingUrl)) return null;

    return { streamingUrl, streamingTitle, lsSession, lsUrl, videoContentId: String(streamingContentId) };
}