import { NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { getSportLeagues } from "@/lib/paramount/sports";
import { CURATED_LEAGUE_KEYS } from "@/lib/paramount/catalogs";
import packageInfo from '@/package.json';

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) {
        return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

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
    // (UFC, NFL on CBS, NBA, PGA, ecc.) + i filtri di stato. Realizza il
    // "sotto-dropdown" richiesto dall'utente.
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

    // 4 sezioni fisse curate + 1 sezione "Altro" con dropdown per lega.
    // Tipo "sport" (custom) per mostrare "Sport" invece di "TV Channel" in Stremio.
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

    const baseUrl = process.env.BASE_URL?.replace(/\/$/, '') ?? new URL(_req.url).origin;
    const logo = `${baseUrl}/icon.png`;
    const background = `${baseUrl}/fanart.png`;

    const manifest = {
        id: "org.pplus.stremio",
        version: packageInfo.version,
        name: "Paramount+",
        description: `Unofficial Paramount+ Addon for Stremio. (Profile ID: ${session.profileId})`,
        logo: logo,
        background: background,
        resources: ["catalog", "meta", "stream"],
        // Tipi supportati: "movie"/"series" per VOD, "tv" per i live channels,
        // "sport" (custom) per la vista sports-only cosi' Stremio mostra "Sport".
        types: ["movie", "series", "tv", "sport"],
        idPrefixes: ["pplus:"],
        catalogs,
    };

    return NextResponse.json(manifest, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
        },
    });
}
