/**
 * Servizio sports (Fase 1/2): recupera e normalizza competizioni ed eventi
 * dalle API Paramount, applica le preferenze per-profilo e l'ordinamento
 * a priorità (My Teams → leghe → coppe → altri sport).
 */
import { ParamountClient, ParamountSession } from "@/lib/paramount/client";
import { StremioMeta } from "@/lib/stremio/types";
import { pplusSportId } from "@/lib/paramount/mapping";
import {
    normalizeLeague,
    normalizeSportEvent,
    SportEvent,
    SportLeague,
    SportPrefs,
    teamKey,
} from "@/lib/paramount/types/sport-models";
import {
    isLicenseUrl,
    msToDateTimeFormat,
    msToUtc,
    normImg,
    pickManifestUrl,
    sessionFingerprint,
} from "@/lib/paramount/utils";
import { SportListingItem } from "@/lib/paramount/types/api";

const LEAGUE_CACHE_TTL = 5 * 60 * 1000; // 5 min
const LEAGUE_LISTINGS_CACHE_TTL = 60 * 1000; // 1 min

const leagueCache = new Map<string, { data: SportLeague[]; expiresAt: number }>();
const leagueListingsCache = new Map<string, { data: SportEvent[]; expiresAt: number }>();

/**
 * Estrae un array di listings da una risposta Paramount, indipendentemente dal
 * "livello" di wrapping (`listings` / `data.listings` / `data.data.listings`)
 * e dal nome del campo (`listing` singolare vs `listings` plurale).
 * Ritorna sempre un array.
 */
function extractListings(data: any): any[] {
    if (!data || typeof data !== "object") return [];
    const candidates = [
        data?.listings,
        data?.data?.listings,
        data?.data?.data?.listings,
        data?.listing,
        data?.data?.listing,
        data?.data?.data?.listing,
    ];
    for (const c of candidates) {
        if (Array.isArray(c)) return c;
    }
    return [];
}

/**
 * Estrae `previousListings` (replay) dalla risposta, gestendo sia la forma flat
 * che nested. Ritorna sempre un array (mai undefined).
 */
function extractPreviousListings(data: any): any[] {
    if (!data || typeof data !== "object") return [];
    const candidates = [
        data?.previousListings,
        data?.data?.previousListings,
        data?.data?.data?.previousListings,
    ];
    for (const c of candidates) {
        if (Array.isArray(c)) return c;
    }
    return [];
}

function extractChannel(data: any): any {
    const ch = data?.channel ?? data?.data?.channel ?? data?.data?.data?.channel;
    if (Array.isArray(ch)) return ch[0];
    return ch ?? null;
}

// ---------------------------------------------------------------------------
// Listings live+upcoming (usato dalle route IPTV m3u / epg.xml).
// Manteniamo qui la cache per-sessione (cross-tenant safe) e il filtro
// opzionale `onlyLive`. Questo sostituisce il vecchio
// lib/paramount/types/sports.ts#getSportListing, rimosso per evitare
// di avere due implementazioni della stessa funzione.
// ---------------------------------------------------------------------------

const SPORT_LISTING_CACHE_TTL = 30 * 1000;
const sportListingCache = new Map<string, { data: SportListingItem[]; expiresAt: number }>();

function filterSportListing(listings: SportListingItem[], onlyLive: boolean): SportListingItem[] {
    const now = Date.now();
    return listings.filter((e) => {
        const isLive = e?.isListingLive === true;
        const startMs =
            typeof e.startTimestamp === "number" ? e.startTimestamp :
                typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp :
                    undefined;
        if (!startMs) return false;
        if (onlyLive) {
            const endMs =
                typeof e.endTimestamp === "number" ? e.endTimestamp :
                    typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp :
                        undefined;
            if (isLive) return true;
            if (endMs && startMs <= now && now < endMs) return true;
            return false;
        }
        return true;
    });
}

/**
 * Recupera i listing live+upcoming dall'endpoint sports.
 * Usato dalle route IPTV (/api/iptv/[key]/playlist.m3u e epg.xml).
 * Cache 30s per session fingerprint (no cross-tenant).
 */
export async function getLiveUpcomingSportListings(session: ParamountSession, onlyLive: boolean): Promise<SportListingItem[]> {
    const cacheKey = sessionFingerprint(session);
    const cached = sportListingCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        return filterSportListing(cached.data, onlyLive);
    }

    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getSportsLiveUpcoming();

    const listings: SportListingItem[] = extractListings(data) as SportListingItem[];

    if (listings.length === 0) {
        console.warn("[sports] empty listings, raw response:", JSON.stringify(data)?.slice(0, 500));
    } else {
        sportListingCache.set(cacheKey, { data: listings, expiresAt: Date.now() + SPORT_LISTING_CACHE_TTL });
    }

    return filterSportListing(listings, onlyLive);
}


/**
 * Recupera tutte le competizioni attive (dall'endpoint live-and-upcoming,
 * raggruppando per channelSlug). Usa il channel del primo listing come
 * metadati della lega.
 */
export async function getSportLeagues(session: ParamountSession): Promise<SportLeague[]> {
    const cacheKey = sessionFingerprint(session);
    const cached = leagueCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getSportsLiveUpcoming();

    const listings = extractListings(data);
    const bySlug = new Map<string, { channel: any; count: number }>();
    for (const e of listings) {
        const slug = e?.channelSlug;
        if (!slug) continue;
        const existing = bySlug.get(slug);
        if (existing) {
            existing.count++;
        } else {
            bySlug.set(slug, { channel: e, count: 1 });
        }
    }

    const leagues: SportLeague[] = [];
    for (const [, { channel }] of bySlug) {
        const league = normalizeLeague(channel);
        if (league) leagues.push(league);
    }

    // Ordina: prima le leghe, poi le coppe, poi i tornei, poi alfabetico.
    const kindOrder = { league: 0, cup: 1, tournament: 2 };
    leagues.sort((a, b) => {
        const ka = kindOrder[a.kind] ?? 3;
        const kb = kindOrder[b.kind] ?? 3;
        if (ka !== kb) return ka - kb;
        return a.name.localeCompare(b.name);
    });

    leagueCache.set(cacheKey, { data: leagues, expiresAt: Date.now() + LEAGUE_CACHE_TTL });
    return leagues;
}

/**
 * Recupera gli eventi di una singola competizione (live + upcoming + replay).
 * `includeReplays` controlla se includere le partite terminate (previousListings).
 *
 * NOTA: gli eventi provenienti da `previousListings` (replay) vengono forzati
 * a `status = "replay"` per evitare che, in assenza di `endTimestamp`, vengano
 * classificati come "live" o "upcoming" da `deriveStatus`.
 */
export async function getLeagueEvents(
    session: ParamountSession,
    slug: string,
    includeReplays = true
): Promise<SportEvent[]> {
    const cacheKey = `${sessionFingerprint(session)}::${slug}::${includeReplays}`;
    const cached = leagueListingsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.data;

    const client = new ParamountClient();
    await client.setSession(session);
    const data = await client.getSportLeagueListings(slug);

    const channel = extractChannel(data);
    const league = normalizeLeague(channel);

    // `extractListings` e `extractPreviousListings` gestiscono automaticamente
    // sia `listing` singolare che `listings` plurale, e qualunque livello
    // di wrapping in `data.*`.
    const current = extractListings(data);
    const previous = includeReplays ? extractPreviousListings(data) : [];

    if (process.env.DEBUG_PARAMOUNT === "1") {
        const topKeys = data && typeof data === "object" ? Object.keys(data).join(",") : "";
        const dataKeys = data?.data && typeof data.data === "object" ? Object.keys(data.data).join(",") : "";
        console.log(
            `[PPLUS] getLeagueEvents slug=${slug} current=${current.length} previous=${previous.length} channel=${channel ? "yes" : "no"} topKeys=[${topKeys}] dataKeys=[${dataKeys}]`
        );
    }

    const events: SportEvent[] = [];
    // Eventi correnti (live + upcoming): status derivato dai timestamp.
    for (const e of current) {
        const ev = normalizeSportEvent(e, league);
        if (ev) events.push(ev);
    }
    // Eventi passati (replay): forziamo lo status a "replay".
    for (const e of previous) {
        const ev = normalizeSportEvent(e, league, { forceStatus: "replay" });
        if (ev) events.push(ev);
    }

    // Ordina per inizio (più recenti prima).
    events.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

    leagueListingsCache.set(cacheKey, { data: events, expiresAt: Date.now() + LEAGUE_LISTINGS_CACHE_TTL });
    return events;
}

/**
 * Applica le preferenze per-profilo: rimuove le leghe nascoste e filtra
 * gli eventi delle squadre preferite.
 */
export function applyPrefs(events: SportEvent[], prefs: SportPrefs): SportEvent[] {
    const hidden = new Set(prefs.hiddenLeagues ?? []);
    const favKeys = new Set((prefs.favoriteTeams ?? []).map((t) => t.key));

    return events.filter((ev) => {
        const home = ev.teams.home?.key;
        const away = ev.teams.away?.key;
        const isFavTeam = (home !== undefined && favKeys.has(home)) || (away !== undefined && favKeys.has(away));
        // Gli eventi delle squadre preferite sono sempre mostrati, anche se la lega è nascosta.
        if (isFavTeam) return true;
        // Le leghe nascoste vengono rimosse (per gli eventi non di squadre preferite).
        if (hidden.has(ev.league.key)) return false;
        return true;
    });
}

/**
 * Ordina gli eventi a priorità:
 * 1) My Teams (eventi delle squadre preferite)
 * 2) leghe delle squadre preferite
 * 3) coppe
 * 4) altri sport
 * All'interno di ogni gruppo, i live prima, poi per data.
 */
export function orderEventsByPriority(events: SportEvent[], prefs: SportPrefs): SportEvent[] {
    const favKeys = new Set((prefs.favoriteTeams ?? []).map((t) => t.key));
    const favLeagueKeys = new Set<string>();
    for (const ev of events) {
        const home = ev.teams.home?.key;
        const away = ev.teams.away?.key;
        if ((home !== undefined && favKeys.has(home)) || (away !== undefined && favKeys.has(away))) {
            favLeagueKeys.add(ev.league.key);
        }
    }

    const kindOrder = { league: 0, cup: 1, tournament: 2 };

    const score = (ev: SportEvent): number => {
        const home = ev.teams.home?.key;
        const away = ev.teams.away?.key;
        const isFavTeam = (home !== undefined && favKeys.has(home)) || (away !== undefined && favKeys.has(away));
        if (isFavTeam) return 0;
        if (favLeagueKeys.has(ev.league.key)) return 1;
        return 2 + (kindOrder[ev.league.kind] ?? 3);
    };

    return [...events].sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        if (sa !== sb) return sa - sb;
        // Live prima.
        const la = a.status === "live" ? 0 : 1;
        const lb = b.status === "live" ? 0 : 1;
        if (la !== lb) return la - lb;
        return (a.startMs ?? 0) - (b.startMs ?? 0);
    });
}

/** Trova un evento per id (per meta/stream). */
export async function findSportEvent(
    session: ParamountSession,
    listingId: string
): Promise<SportEvent | null> {
    const leagues = await getSportLeagues(session);
    for (const league of leagues) {
        const events = await getLeagueEvents(session, league.key, true);
        const found = events.find((ev) => ev.id === listingId);
        if (found) return found;
    }
    return null;
}

/** Normalizza una squadra preferita da un input utente. */
export function makeFavoriteTeam(name: string): { key: string; name: string } {
    const trimmed = name.trim();
    return { key: teamKey(trimmed), name: trimmed };
}

const STATUS_LABEL: Record<string, string> = {
    live: "🔴 LIVE",
    upcoming: "⏳ Upcoming",
    replay: "▶️ Replay",
};

/** Mappa un SportEvent normalizzato in una StremioMeta. */
export function mapSportEventToMeta(ev: SportEvent): StremioMeta | null {
    if (!ev.id || !ev.title) return null;

    const descParts: string[] = [];
    descParts.push(ev.league.name);
    if (ev.status) descParts.push(STATUS_LABEL[ev.status] ?? ev.status);
    if (ev.startMs) descParts.push(`Start: ${msToDateTimeFormat(ev.startMs)}`);
    if (ev.endMs) descParts.push(`End: ${msToDateTimeFormat(ev.endMs)}`);
    if (ev.description) descParts.push(ev.description);

    const genres = ["Paramount+", "Sport", ev.league.name];
    if (ev.teams.home) genres.push(ev.teams.home.name);
    if (ev.teams.away) genres.push(ev.teams.away.name);

    return {
        id: pplusSportId(ev.id),
        type: "tv",
        name: ev.title,
        poster: normImg(ev.posterUrl),
        background: normImg(ev.posterUrl),
        logo: normImg(ev.logoUrl),
        posterShape: "landscape",
        description: descParts.join(" • "),
        releaseInfo: msToUtc(ev.startMs),
        genres,
    } as StremioMeta;
}

/**
 * Risolve lo stream di un evento sportivo (live, upcoming o replay) a partire
 * dal suo videoContentId. Usato sia per gli eventi live/upcoming sia per i
 * replay (previousListings), che non compaiono nell'endpoint live-and-upcoming.
 */
export async function resolveSportEventStream(
    session: ParamountSession,
    event: SportEvent
): Promise<{
    streamingUrl: string;
    streamingTitle: string;
    lsSession: string;
    lsUrl: string | undefined;
    videoContentId: string;
} | null> {
    const videoContentId = event.videoContentId;
    if (!videoContentId) return null;

    const client = new ParamountClient();
    await client.setSession(session);
    const tokenResp = await client.getIrdetoSessionToken(String(videoContentId));

    const streamingUrl = pickManifestUrl(tokenResp);
    const streamingTitle = `📺 ${String(event.title ?? "Event")}`;
    const lsSession = tokenResp?.ls_session;
    const lsUrl = tokenResp?.url;

    if (!streamingUrl || !lsSession) return null;
    if (isLicenseUrl(streamingUrl)) return null;

    return { streamingUrl, streamingTitle, lsSession, lsUrl, videoContentId: String(videoContentId) };
}
