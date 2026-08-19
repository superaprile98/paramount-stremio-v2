import { ParamountClient, ParamountSession } from "@/lib/paramount/client";
import { StremioMeta } from "@/lib/stremio/types";
import { pplusMovieId, pplusSeriesId } from "@/lib/paramount/mapping";
import { isLicenseUrl, normImg, pickManifestUrl, pickPoster } from "@/lib/paramount/utils";
import { VodItem } from "@/lib/paramount/types/api";

/**
 * Cerca ricorsivamente un URL immagine poster all'interno dell'oggetto.
 * Gli item di movies/trending.json non espongono i campi poster a livello
 * top-level: le immagini sono annidate (es. movieAssets, movieContent, ...).
 */
function findPosterUrl(obj: unknown, depth = 0): string | undefined {
    if (obj == null || depth > 6) return undefined;
    if (typeof obj === "string") {
        return /^https?:\/\//.test(obj) && /(poster|thumb|image|logo|artwork)/i.test(obj)
            ? obj
            : undefined;
    }
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const found = findPosterUrl(item, depth + 1);
            if (found) return found;
        }
        return undefined;
    }
    if (typeof obj === "object") {
        const rec = obj as Record<string, unknown>;
        // Campi immagine noti, in ordine di priorità
        for (const key of [
            "filePathPoster", "posterUrl", "filepathPoster", "poster",
            "filePathThumb", "filepathThumb", "filePathWideThumb",
            "filepathShowGroupItemLogo", "filepathShowLogo", "filePathLogo",
        ]) {
            const v = rec[key];
            if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
        }
        for (const key of Object.keys(rec)) {
            if (key.toLowerCase().includes("poster") || key.toLowerCase().includes("thumb")) {
                const v = rec[key];
                if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
            }
        }
        for (const key of Object.keys(rec)) {
            const found = findPosterUrl(rec[key], depth + 1);
            if (found) return found;
        }
    }
    return undefined;
}

/**
 * Mapping di un item movie/series (risposta API Paramount+) verso StremioMeta.
 * I campi della risposta variano tra endpoint: usiamo accessi difensivi.
 */
export function mapMovieToMeta(e: VodItem | null | undefined): StremioMeta | null {
    const contentId = e?.contentId ?? e?.id ?? e?.guid;
    const title = e?.title ?? e?.name;
    if (!contentId || !title) return null;

    const poster = pickPoster(e)
        ?? normImg(e?.filePathPoster ?? e?.posterUrl)
        ?? findPosterUrl(e);
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

    // Gli item di shows/group/{id}.json usano filepathShowGroupItemLogo/filepathShowLogo
    const poster = pickPoster(e)
        ?? normImg(e?.filePathPoster ?? e?.posterUrl)
        ?? normImg((e as any)?.filepathShowGroupItemLogo)
        ?? normImg((e as any)?.filepathShowLogo);
    const genres = Array.isArray(e?.genres)
        ? e.genres.map((g: any) => String(g?.name ?? g ?? "")).filter(Boolean)
        : [];

    return {
        id: pplusSeriesId(String(showId)),
        type: "series",
        name: String(title),
        poster,
        background: poster,
        logo: normImg(e?.filePathLogo ?? (e as any)?.filepathShowLogo),
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
    // Endpoint shows/group/{id}.json → { group: { showGroupItems: [...] } }
    if (Array.isArray((data as any)?.group?.showGroupItems)) return (data as any).group.showGroupItems as VodItem[];
    // Endpoint movies/trending.json → { trending: [ { content: {...} } ] }
    if (Array.isArray((data as any)?.trending)) {
        return (data as any).trending
            .map((t: any) => t?.content ?? t)
            .filter(Boolean) as VodItem[];
    }
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
    const data = await client.getAllShows();
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