import { ParamountSession } from "@/lib/paramount/client";
import { StremioMeta } from "@/lib/stremio/types";
import { getLiveListing, mapLiveListingToMeta } from "@/lib/paramount/types/live";
import { getTrendingMovies, getTrendingShows, searchVod } from "@/lib/paramount/types/vod";
import {
    getSportLeagues,
    getLeagueEvents,
    applyPrefs,
    mapSportEventToMeta,
} from "@/lib/paramount/sports";
import { getPrefs } from "@/lib/paramount/prefs";
import { SportEvent } from "@/lib/paramount/types/sport-models";

/** Leghe con una sezione dedicata nella home (le altre vanno in "Altro"). */
export const CURATED_LEAGUE_KEYS = new Set<string>([
    "serie-a",
    "uefa-champions-league",
    "uefa-europa-league",
    "uefa-conference-league",
]);

/** Ritorna true se la lega ha una sezione dedicata nella home (le altre vanno in "Altro"). */
export function isCuratedLeague(leagueKey: string): boolean {
    return CURATED_LEAGUE_KEYS.has(leagueKey);
}

function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

function safeLower(s?: string) {
    return (s ?? "").toLowerCase();
}

/**
 * Vista sports-only LIVE-ONLY: 4 sezioni curate + 1 sezione "Altro".
 *
 * I replay Paramount+ sono DASH Widevine (DRM) e non riproducibili su Stremio
 * desktop (mpv) né in modo affidabile su web; live e DVR "From Start" sono
 * HLS AES-128 e funzionano su tutti i client. Per questo i cataloghi mostrano
 * solo eventi con status "live" e non richiedono i replay VOD catch-up.
 *
 * La sezione "Altro" accetta un filtro genre che puo' essere:
 *  - "Live" (filtro di stato)
 *  - il nome di una lega (es. "UFC", "NFL on CBS") → filtra per quella lega
 */
export async function getCatalogMetas(args: {
    type: string;
    id: string;
    session: ParamountSession;
    extra?: { search?: string; skip?: number; genre?: string };
}): Promise<StremioMeta[]> {
    const { type, session, extra } = args;
    const id = stripJsonSuffix(args.id);

    const skip = extra?.skip ?? 0;
    const search = safeLower(extra?.search);
    const genre = extra?.genre;
    const pageSize = 100;

    //VOD — Movies
    if (type === "movie" && id === "pplus_movies") {
        const movies = search
            ? await searchVod(session, search)
            : await getTrendingMovies(session);
        return movies.slice(skip, skip + pageSize);
    }

    //VOD — Series
    if (type === "series" && id === "pplus_series") {
        const shows = search
            ? await searchVod(session, search)
            : await getTrendingShows(session);
        return shows.slice(skip, skip + pageSize);
    }

    //Live
    if (type === "tv" && id === "pplus_live") {
        const liveListings = await getLiveListing(session);
        const liveMetas = liveListings.map(mapLiveListingToMeta) as StremioMeta[];

        const filteredBySearch = search
            ? liveMetas.filter((m) => safeLower(m.name).includes(search))
            : liveMetas;

        return filteredBySearch.slice(skip, skip + pageSize);
    }

    //Sport — vista sports-only (4 sezioni curate + "Altro")
    if (type === "sport" && id.startsWith("pplus_sports_")) {
        const profileId = session.profileId ?? 0;
        const prefs = getPrefs(profileId);

        let events: SportEvent[] = [];

        if (id === "pplus_sports_live") {
            // Slider "Live adesso" in home: eventi in corso delle 4 leghe curate,
            // ordinati per orario di inizio (il primo che e' partito viene mostrato per primo).
            for (const leagueKey of CURATED_LEAGUE_KEYS) {
                const leagueEvents = await getLeagueEvents(session, leagueKey, false);
                events.push(...applyPrefs(leagueEvents, prefs));
            }
            events = events.filter((e) => e.status === "live");
            events.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
        } else if (id === "pplus_sports_other") {
            // "Altro": tutte le leghe tranne quelle curate.
            const leagues = await getSportLeagues(session);

            // Se il genre e' il nome di una lega, filtriamo per quella lega.
            // Altrimenti mostriamo tutte le leghe non curate.
            const filterByLeagueName = genre && genre !== "Live";
            const targetLeagues = filterByLeagueName
                ? leagues.filter((l) => l.name === genre && !CURATED_LEAGUE_KEYS.has(l.key))
                : leagues.filter((l) => !CURATED_LEAGUE_KEYS.has(l.key));

            for (const league of targetLeagues) {
                const leagueEvents = await getLeagueEvents(session, league.key, false);
                events.push(...applyPrefs(leagueEvents, prefs));
            }
        } else {
            // pplus_sports_<leagueKey>: una singola competizione (Serie A, UCL, UEL, UECL).
            const leagueKey = id.slice("pplus_sports_".length);
            const leagueEvents = await getLeagueEvents(session, leagueKey, false);
            events = applyPrefs(leagueEvents, prefs);
        }

        // Vista live-only: mostriamo solo eventi in corso.
        events = events.filter((e) => e.status === "live");

        const sportMetas = events.map(mapSportEventToMeta).filter(Boolean) as StremioMeta[];

        const filteredBySearch = search
            ? sportMetas.filter((m) => safeLower(m.name).includes(search))
            : sportMetas;

        return filteredBySearch.slice(skip, skip + pageSize);
    }

    return [];
}
