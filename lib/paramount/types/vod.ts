import { ParamountClient, ParamountSession } from "@/lib/paramount/client";
import { StremioMeta } from "@/lib/stremio/types";
import { pplusMovieId, pplusSeriesId } from "@/lib/paramount/mapping";
import { isLicenseUrl, normImg, pickManifestUrl, pickPoster } from "@/lib/paramount/utils";
import { VodItem } from "@/lib/paramount/types/api";

/**
 * Mapping di un item movie/series (risposta API Paramount+) verso StremioMeta.
 * I campi della risposta variano tra endpoint: usiamo accessi difensivi.
 */
export function mapMovieToMeta(e: VodItem | null | undefined): StremioMeta | null {
    const contentId = e?.contentId ?? e?.id ?? e?.guid;
    const title = e?.title ?? e?.name;
    if (!contentId || !title) return null;

    const poster = pickPoster(e) ?? normImg(e?.filePathPoster ?? e?.posterUrl);
    const genres = Array.isArray(e?.genres)
        ? e.genres.map((g: any) => String(g?.name ?? g ?? "")).filter(Boolean)
        : [];

    return {
        id: pplusMovieId(String(contentId)),
        type: "movie",
        name: String(title),
        poster,
        background: poster,
        logo: normImg(e?.filePathLogo),
        posterShape: "poster",
        description: String(e?.description ?? e?.longDescription ?? ""),
        releaseInfo: e?.year ? String(e.year) : undefined,
        genres: ["Paramount+", ...genres],
    } as StremioMeta;
}

export function mapShowToMeta(e: VodItem | null | undefined): StremioMeta | null {
    const showId = e?.showId ?? e?.contentId ?? e?.id ?? e?.guid;
    const title = e?.title ?? e?.name;
    if (!showId || !title) return null;

    const poster = pickPoster(e) ?? normImg(e?.filePathPoster ?? e?.posterUrl);
    const genres = Array.isArray(e?.genres)
        ? e.genres.map((g: any) => String(g?.name ?? g ?? "")).filter(Boolean)
        : [];

    return {
        id: pplusSeriesId(String(showId)),
        type: "series",
        name: String(title),
        poster,
        background: poster,
        logo: normImg(e?.filePathLogo),
        posterShape: "poster",
        description: String(e?.description ?? e?.longDescription ?? ""),
        releaseInfo: e?.year ? String(e.year) : undefined,
        genres: ["Paramount+", ...genres],
    } as StremioMeta;
}

/** Estrae l'array di item da una risposta API (struttura variabile). */
function extractItems(data: unknown): VodItem[] {
    if (Array.isArray(data)) return data as VodItem[];
    if (Array.isArray((data as any)?.items)) return (data as any).items as VodItem[];
    if (Array.isArray((data as any)?.itemList)) return (data as any).itemList as VodItem[];
    if (Array.isArray((data as any)?.data?.items)) return (data as any).data.items as VodItem[];
    if (Array.isArray((data as any)?.data?.itemList)) return (data as any).data.itemList as VodItem[];
    if (Array.isArray((data as any)?.result)) return (data as any).result as VodItem[];
    return [];
}

export async function getTrendingMovies(session: ParamountSession): Promise<StremioMeta[]> {
    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getTrendingMovies();
    return extractItems(data).map(mapMovieToMeta).filter(Boolean) as StremioMeta[];
}

export async function getTrendingShows(session: ParamountSession): Promise<StremioMeta[]> {
    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getTrendingShows();
    return extractItems(data).map(mapShowToMeta).filter(Boolean) as StremioMeta[];
}

export async function searchVod(session: ParamountSession, term: string): Promise<StremioMeta[]> {
    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getSearch(term);
    const items = extractItems(data);
    const metas: StremioMeta[] = [];
    for (const item of items) {
        const type = item?.type ?? item?.contentType ?? item?.mediaType;
        const t = String(type ?? "").toLowerCase();
        if (t.includes("movie") || t === "movie") {
            const m = mapMovieToMeta(item);
            if (m) metas.push(m);
        } else if (t.includes("series") || t.includes("show") || t === "episode") {
            const m = mapShowToMeta(item);
            if (m) metas.push(m);
        }
    }
    return metas;
}

export async function buildMovieMeta(session: ParamountSession, movieId: string): Promise<StremioMeta | null> {
    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getMovie(movieId);
    const item = extractItems(data)[0] ?? (data as unknown as VodItem);
    return mapMovieToMeta(item);
}

export async function buildSeriesMeta(session: ParamountSession, showId: string): Promise<StremioMeta | null> {
    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getShow(showId);
    const item = extractItems(data)[0] ?? (data as unknown as VodItem);
    return mapShowToMeta(item);
}

/**
 * Risolve lo stream VOD (movie/series) tramite il token Irdeto.
 * Restituisce il manifest MPD e la sessione licenza, oppure null con motivo.
 */
export async function resolveVodStream(
    session: ParamountSession,
    contentId: string
): Promise<{
    streamingUrl: string;
    streamingTitle: string;
    lsSession: string;
    lsUrl: string | undefined;
    videoContentId: string;
} | null> {
    const client = new ParamountClient();
    await client.setSession(session);
    const tokenResp = await client.getIrdetoSessionToken(contentId);

    const streamingUrl = pickManifestUrl(tokenResp);
    const lsSession = tokenResp?.ls_session;
    const lsUrl = tokenResp?.url;

    if (!streamingUrl || !lsSession) {
        console.warn(`[vod] no manifest or ls_session for ${contentId}`);
        return null;
    }
    if (isLicenseUrl(streamingUrl)) {
        console.warn(`[vod] manifest is a license URL (DRM-only) for ${contentId}: ${streamingUrl}`);
        return null;
    }

    return {
        streamingUrl,
        streamingTitle: "🎬 VOD",
        lsSession,
        lsUrl,
        videoContentId: contentId,
    };
}