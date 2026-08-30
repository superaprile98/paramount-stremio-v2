/**
 * Modelli dati normalizzati per la vista sports-only (Fase 1).
 *
 * I tipi qui sotto sono il "contratto" interno dell'addon: normalizzano le
 * risposte Paramount (listing + channel) in una forma stabile e indipendente
 * dall'API, così i cataloghi, le preferenze e l'ordinamento a priorità
 * lavorano su un unico modello.
 */

/** Categoria sportiva di alto livello (per raggruppare i cataloghi). */
export type SportCategory =
    | "soccer"
    | "american-football"
    | "basketball"
    | "combat"
    | "golf"
    | "other";

/** Tipo di competizione: usato per l'ordinamento a priorità (leghe → coppe). */
export type LeagueKind = "league" | "cup" | "tournament";

/** Stato di un evento sportivo. */
export type SportEventStatus = "live" | "upcoming" | "replay";

/** Competizione/campionato normalizzato (derivato dal `channel` Paramount). */
export interface SportLeague {
    /** Slug stabile, es. "serie-a", "uefa-champions-league". */
    key: string;
    /** Nome leggibile, es. "Serie A". */
    name: string;
    description?: string;
    logoUrl?: string;
    /** Categoria sportiva. */
    sport: SportCategory;
    /** Tipo di competizione (per l'ordinamento a priorità). */
    kind: LeagueKind;
}

/** Squadra (derivata dal parsing del titolo "Team A vs. Team B"). */
export interface SportTeam {
    name: string;
    /** Slug normalizzato della squadra (per le preferite). */
    key: string;
}

/** Evento sportivo normalizzato. */
export interface SportEvent {
    /** Id del listing Paramount. */
    id: string;
    /** Titolo, es. "Inter vs. Monza". */
    title: string;
    sport: SportCategory;
    league: SportLeague;
    teams: { home?: SportTeam; away?: SportTeam };
    status: SportEventStatus;
    startMs?: number;
    endMs?: number;
    videoContentId?: string;
    posterUrl?: string;
    logoUrl?: string;
    description?: string;
    /** Riferimento al listing grezzo (per lo streaming). */
    raw: unknown;
}

/** Preferenze per-profilo (squadre preferite + leghe nascoste). */
export interface SportPrefs {
    /** Squadre preferite, ordinate (possono essere più di una). */
    favoriteTeams: SportTeam[];
    /** Slug delle leghe nascoste dall'utente. */
    hiddenLeagues: string[];
}

/** Slug normalizzato di una squadra (lowercase, senza spazi/punteggiatura). */
export function teamKey(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]+/g, "")
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** Mappa slug → categoria sportiva (dai vTag/primaryCategory osservati). */
const SPORT_CATEGORY_BY_SLUG: Record<string, SportCategory> = {
    "serie-a": "soccer",
    "uefa-champions-league": "soccer",
    "uefa-europa-league": "soccer",
    "uefa-conference-league": "soccer",
    "uefa-super-cup": "soccer",
    "womens-champions-league": "soccer",
    "coppa-italia": "soccer",
    "english-football-league": "soccer",
    "efl-cup": "soccer",
    "scottish-professional-football-league": "soccer",
    "liga-profesional-argentina": "soccer",
    "brasileirao": "soccer",
    "nwsl": "soccer",
    "concacaf-champions-cup": "soccer",
    "concacaf-nations-league": "soccer",
    "afc-champions-league": "soccer",
    "us-open-cup": "soccer",
    "nfl-on-cbs": "american-football",
    "college-football": "american-football",
    "ncaa-mens-basketball": "basketball",
    "wnba": "basketball",
    "ufc": "combat",
    "dana-white-contender-series": "combat",
    "boxing": "combat",
    "pga": "golf",
    "masters": "golf",
    "pbr-teams-series": "other",
    "sailgp": "other",
    "world-rugby": "other",
};

/** Tipo di competizione per slug (default: league). */
const LEAGUE_KIND_BY_SLUG: Record<string, LeagueKind> = {
    "uefa-champions-league": "cup",
    "uefa-europa-league": "cup",
    "uefa-conference-league": "cup",
    "uefa-super-cup": "cup",
    "womens-champions-league": "cup",
    "coppa-italia": "cup",
    "efl-cup": "cup",
    "concacaf-champions-cup": "cup",
    "concacaf-nations-league": "cup",
    "afc-champions-league": "cup",
    "us-open-cup": "cup",
    "masters": "tournament",
    "pga": "tournament",
    "pbr-teams-series": "tournament",
    "sailgp": "tournament",
    "world-rugby": "tournament",
};

/** Normalizza una competizione dal `channel` Paramount. */
export function normalizeLeague(channel: any): SportLeague | null {
    const slug = channel?.slug ?? channel?.channelSlug;
    const name = channel?.channelName ?? channel?.name ?? slug;
    if (!slug || !name) return null;

    const key = String(slug);
    return {
        key,
        name: String(name),
        description: channel?.description ? String(channel.description) : undefined,
        logoUrl: channel?.filePathLogo ? String(channel.filePathLogo) : undefined,
        sport: SPORT_CATEGORY_BY_SLUG[key] ?? "other",
        kind: LEAGUE_KIND_BY_SLUG[key] ?? "league",
    };
}

/** Estrae le squadre dal titolo "Team A vs. Team B" (o "Team A @ Team B"). */
export function parseTeams(title: string): { home?: SportTeam; away?: SportTeam } {
    const m = title.match(/^(.+?)\s+(?:vs\.?|@|–|-)\s+(.+)$/i);
    if (!m) return {};
    const home = m[1].trim();
    const away = m[2].trim();
    if (!home || !away) return {};
    return {
        home: { name: home, key: teamKey(home) },
        away: { name: away, key: teamKey(away) },
    };
}

/** Determina lo stato di un evento in base ai timestamp e al flag live. */
export function deriveStatus(
    isLive: boolean | undefined,
    startMs: number | undefined,
    endMs: number | undefined,
    now: number = Date.now()
): SportEventStatus {
    if (isLive === true) return "live";
    if (startMs !== undefined && startMs > now) return "upcoming";
    // In corso: finestra start..end nota e che contiene "now". Paramount a
    // volte non flagga `isListingLive` per partite gia' iniziate: senza questa
    // verifica l'evento finirebbe tra i replay e i cataloghi Live risultano vuoti.
    if (startMs !== undefined && startMs <= now && endMs !== undefined && endMs > now) {
        return "live";
    }
    // Evento passato: se endMs noto ed e' nel passato, replay;
    // altrimenti (endMs mancante) classifica come replay se
    // l'inizio e' nel passato (tipico dei listing in previousListings
    // senza timestamp di fine esplicito).
    if (endMs !== undefined && endMs < now) return "replay";
    if (startMs !== undefined && startMs <= now) return "replay";
    return "upcoming";
}

/** Normalizza un listing sportivo Paramount in un SportEvent. */
export function normalizeSportEvent(
    e: any,
    league: SportLeague | null,
    options?: { forceStatus?: SportEventStatus }
): SportEvent | null {
    const id = e?.id;
    const title = e?.title;
    if (id === undefined || id === null || !title) return null;

    const startMs =
        typeof e.streamStartTimestamp === "number" ? e.streamStartTimestamp :
            typeof e.startTimestamp === "number" ? e.startTimestamp :
                undefined;
    const endMs =
        typeof e.streamEndTimestamp === "number" ? e.streamEndTimestamp :
            typeof e.endTimestamp === "number" ? e.endTimestamp :
                undefined;

    const fallbackLeague: SportLeague = league ?? {
        key: String(e?.channelSlug ?? "unknown"),
        name: String(e?.channelName ?? e?.channelSlug ?? "Sport"),
        sport: "other",
        kind: "league",
    };

    const poster =
        e?.filePathThumb ? String(e.filePathThumb) :
            e?.filepathFallbackImage ? String(e.filepathFallbackImage) :
                e?.filePathLogo ? String(e.filePathLogo) :
                    undefined;

    const derivedStatus = deriveStatus(e?.isListingLive, startMs, endMs);
    // Se forceStatus e' specificato e diverso da "upcoming", ha la precedenza
    // sulla derivazione automatica (utile per forzare "replay" sugli eventi
    // provenienti da previousListings anche quando i timestamp mancano).
    const status: SportEventStatus =
        options?.forceStatus && options.forceStatus !== "upcoming"
            ? options.forceStatus
            : derivedStatus;

    return {
        id: String(id),
        title: String(title),
        sport: fallbackLeague.sport,
        league: fallbackLeague,
        teams: parseTeams(String(title)),
        status,
        startMs,
        endMs,
        videoContentId: e?.videoContentId ? String(e.videoContentId) : undefined,
        posterUrl: poster,
        logoUrl: e?.filePathLogo ? String(e.filePathLogo) : undefined,
        description: e?.description ? String(e.description) : undefined,
        raw: e,
    };
}
