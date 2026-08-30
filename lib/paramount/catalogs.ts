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
 * Vista sports-only con UNICO catalogo "Sport" (dropdown con tutte le leghe).
 *
 * I replay Paramount+ sono DASH Widevine (DRM) e non riproducibili su Stremio
 * desktop (mpv) né in modo affidabile su web; live e DVR "From Start" sono
 * HLS AES-128 e funzionano su tutti i client. Per questo i cataloghi mostrano
 * solo eventi live e upcoming (niente replay VOD catch-up), ordinati: prima
 * i live, poi gli upcoming per orario di inizio.
 *
 * Il filtro genre del catalogo "pplus_sports" puo' essere:
 *  - "Tutte" (default) → eventi di tutte le leghe
 *  - il nome di una lega (es. "Serie A", "UFC") → filtra per quella lega
 *
 * Gli id legacy (pplus_sports_live, pplus_sports_<leagueKey>,
 * pplus_sports_other) restano gestiti per i manifest ancora in cache nei
 * client gia' installati, con la stessa semantica live+upcoming.
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

    //Sport — vista sports-only (unico catalogo "Sport" + id legacy)
    if (type === "sport" && (id === "pplus_sports" || id.startsWith("pplus_sports_"))) {
        const profileId = session.profileId ?? 0;
        const prefs = getPrefs(profileId);

        let events: SportEvent[] = [];

        if (id === "pplus_sports") {
            // Unico catalogo: "Tutte" (default) o una lega specifica dal dropdown.
            const leagues = await getSportLeagues(session);
            const targetLeagues =
                genre && genre !== "Tutte"
                    ? leagues.filter((l) => l.name === genre)
                    : leagues;

            for (const league of targetLeagues) {
                const leagueEvents = await getLeagueEvents(session, league.key, false);
                events.push(...applyPrefs(leagueEvents, prefs));
            }
        } else if (id === "pplus_sports_live") {
            // Legacy (manifest in cache): slider home con le 4 leghe curate.
            for (const leagueKey of CURATED_LEAGUE_KEYS) {
                const leagueEvents = await getLeagueEvents(session, leagueKey, false);
                events.push(...applyPrefs(leagueEvents, prefs));
            }
        } else if (id === "pplus_sports_other") {
            // Legacy (manifest in cache): "Altro", tutte le leghe tranne quelle curate.
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
            // Legacy (manifest in cache): pplus_sports_<leagueKey>, una singola competizione.
            const leagueKey = id.slice("pplus_sports_".length);
            const leagueEvents = await getLeagueEvents(session, leagueKey, false);
            events = applyPrefs(leagueEvents, prefs);
        }

        // Vista live+upcoming (niente replay DRM): prima i live, poi gli upcoming.
        events = events.filter((e) => e.status === "live" || e.status === "upcoming");
        events.sort((a, b) => {
            const la = a.status === "live" ? 0 : 1;
            const lb = b.status === "live" ? 0 : 1;
            if (la !== lb) return la - lb;
            return (a.startMs ?? 0) - (b.startMs ?? 0);
        });

        const sportMetas = events.map(mapSportEventToMeta).filter(Boolean) as StremioMeta[];

        const filteredBySearch = search
            ? sportMetas.filter((m) => safeLower(m.name).includes(search))
            : sportMetas;

        return filteredBySearch.slice(skip, skip + pageSize);
    }

    return [];
}
