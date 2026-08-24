import packageInfo from "@/package.json";
import { ParamountSession, ParamountClient } from "@/lib/paramount/client";
import { getSportLeagues } from "@/lib/paramount/sports";
import { CURATED_LEAGUE_KEYS } from "@/lib/paramount/catalogs";

/**
 * Costruisce il manifest Stremio per una session Paramount+ valida.
 * Riutilizzato da /api/stremio/[key]/manifest.json e /api/install/[token].
 */
export async function buildManifest(session: ParamountSession, baseUrl: string): Promise<object> {
    // Le 4 sezioni curate hanno un filtro genre fisso (Live/Upcoming/Replay).
    const curatedExtra = [
        {
            name: "genre",
            isRequired: false,
            options: ["Live", "Upcoming", "Replay"],
        },
        { name: "search" },
        { name: "skip" },
    ];

    // Sezione "Altro": il genre e' dinamico e contiene le leghe rimanenti
    // (UFC, NFL on CBS, NBA, PGA, ecc.) + i filtri di stato.
    let otherGenreOptions: string[] = ["Live", "Upcoming", "Replay"];
    try {
        const leagues = await getSportLeagues(session);
        const otherLeagueNames = leagues
            .filter((l) => !CURATED_LEAGUE_KEYS.has(l.key))
            .map((l) => l.name);
        otherGenreOptions = [...otherGenreOptions, ...otherLeagueNames];
    } catch {
        // Se la chiamata fallisce, manteniamo solo i filtri di stato.
    }

    const otherExtra = [
        {
            name: "genre",
            isRequired: false,
            options: otherGenreOptions,
        },
        { name: "search" },
        { name: "skip" },
    ];

    const catalogs: any[] = [
        {
            type: "sport",
            id: "pplus_sports_serie-a",
            name: "Serie A",
            extra: curatedExtra,
        },
        {
            type: "sport",
            id: "pplus_sports_uefa-champions-league",
            name: "UEFA Champions League",
            extra: curatedExtra,
        },
        {
            type: "sport",
            id: "pplus_sports_uefa-europa-league",
            name: "UEFA Europa League",
            extra: curatedExtra,
        },
        {
            type: "sport",
            id: "pplus_sports_uefa-conference-league",
            name: "UEFA Conference League",
            extra: curatedExtra,
        },
        {
            type: "sport",
            id: "pplus_sports_other",
            name: "Altro",
            extra: otherExtra,
        },
    ];

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    const logo = `${cleanBaseUrl}/icon.png`;
    const background = `${cleanBaseUrl}/fanart.png`;

    return {
        id: "org.pplus.stremio",
        version: packageInfo.version,
        name: "Paramount+",
        description: `Unofficial Paramount+ Addon for Stremio. (Profile ID: ${session.profileId})`,
        logo,
        background,
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series", "tv", "sport"],
        idPrefixes: ["pplus:"],
        catalogs,
    };
}