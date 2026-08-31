import { describe, it, expect } from "vitest";
import {
    teamKey,
    parseTeams,
    deriveStatus,
    normalizeLeague,
    normalizeSportEvent,
    SportEvent,
    SportPrefs,
} from "@/lib/paramount/sport-models";
import {
    applyPrefs,
    orderEventsByPriority,
    mapSportEventToMeta,
    makeFavoriteTeam,
} from "@/lib/paramount/sports";
import { CURATED_LEAGUE_KEYS, isCuratedLeague } from "@/lib/paramount/sports";

describe("sport-models: teamKey", () => {
    it("normalizes a team name to a slug", () => {
        expect(teamKey("Inter Milan")).toBe("inter-milan");
    });

    it("strips accents and punctuation", () => {
        expect(teamKey("São Paulo F.C.")).toBe("sao-paulo-fc");
    });

    it("handles empty input", () => {
        expect(teamKey("")).toBe("");
    });
});

describe("sport-models: parseTeams", () => {
    it("parses 'Team A vs. Team B'", () => {
        const t = parseTeams("Inter vs. Monza");
        expect(t.home?.name).toBe("Inter");
        expect(t.away?.name).toBe("Monza");
        expect(t.home?.key).toBe("inter");
    });

    it("parses 'Team A @ Team B'", () => {
        const t = parseTeams("Milan @ Juventus");
        expect(t.home?.name).toBe("Milan");
        expect(t.away?.name).toBe("Juventus");
    });

    it("returns empty for a title without teams", () => {
        expect(parseTeams("UEFA Champions League Highlights")).toEqual({});
    });
});

describe("sport-models: deriveStatus", () => {
    const now = 1000;
    it("returns live when isLive is true", () => {
        expect(deriveStatus(true, 500, 2000, now)).toBe("live");
    });

    it("returns upcoming when start is in the future", () => {
        expect(deriveStatus(false, 2000, 3000, now)).toBe("upcoming");
    });

    it("returns live when now is inside the start..end window even without isListingLive", () => {
        // Bug fix: Paramount a volte non flagga isListingLive per partite in
        // corso; senza questa regola l'evento finiva tra i replay e i cataloghi
        // Live risultavano vuoti durante la partita.
        expect(deriveStatus(false, 500, 3000, now)).toBe("live");
        expect(deriveStatus(undefined, 500, 3000, now)).toBe("live");
    });

    it("returns replay when end is in the past", () => {
        expect(deriveStatus(false, 0, 500, now)).toBe("replay");
    });

    // Bug fix: prima della fix un evento passato senza endMs veniva classificato
    // come "live" e i replay non comparivano nella sezione Replay. Ora viene
    // correttamente classificato come "replay".
    it("returns replay when start has passed but no end (previousListings fix)", () => {
        expect(deriveStatus(false, 500, undefined, now)).toBe("replay");
    });

    it("returns upcoming when start is in the future and no end", () => {
        expect(deriveStatus(false, 2000, undefined, now)).toBe("upcoming");
    });
});

describe("sport-models: normalizeLeague", () => {
    it("maps a channel to a league with sport category and kind", () => {
        const league = normalizeLeague({ slug: "serie-a", channelName: "Serie A" });
        expect(league?.key).toBe("serie-a");
        expect(league?.name).toBe("Serie A");
        expect(league?.sport).toBe("soccer");
        expect(league?.kind).toBe("league");
    });

    it("classifies a cup competition", () => {
        const league = normalizeLeague({ slug: "uefa-champions-league", channelName: "UEFA Champions League" });
        expect(league?.kind).toBe("cup");
    });

    it("returns null when slug and name are missing", () => {
        expect(normalizeLeague({})).toBeNull();
    });
});

describe("sport-models: normalizeSportEvent", () => {
    it("normalizes a listing into a SportEvent", () => {
        const ev = normalizeSportEvent(
            {
                id: "evt-1",
                title: "Inter vs. Monza",
                channelSlug: "serie-a",
                channelName: "Serie A",
                isListingLive: true,
                streamStartTimestamp: 1000,
                streamEndTimestamp: 2000,
                videoContentId: "vc-1",
            },
            null
        );
        expect(ev?.id).toBe("evt-1");
        expect(ev?.title).toBe("Inter vs. Monza");
        expect(ev?.status).toBe("live");
        expect(ev?.teams.home?.name).toBe("Inter");
        expect(ev?.videoContentId).toBe("vc-1");
    });

    it("returns null when id or title is missing", () => {
        expect(normalizeSportEvent({ id: "x" }, null)).toBeNull();
        expect(normalizeSportEvent({ title: "y" }, null)).toBeNull();
    });

    it("derives replay for past events without endMs", () => {
        // Listing senza endMs (tipico di Paramount): l'inizio e' nel passato
        // quindi l'evento e' classificato come replay e filtrato dai cataloghi.
        const ev = normalizeSportEvent(
            {
                id: "evt-rep",
                title: "Replay Match",
                channelSlug: "serie-a",
                channelName: "Serie A",
                streamStartTimestamp: 500, // passato
                // streamEndTimestamp mancante
            },
            null
        );
        expect(ev?.status).toBe("replay");
    });
});

describe("catalogs: Altro with league-name genre filter", () => {
    it("non-curated leagues map to 'Altro'", () => {
        // Non serve un test runtime percio': la logica di selezione delle
        // leghe per la sezione Altro dipende dal manifest dinamico.
        // Verifichiamo solo che l'helper isCuratedLeague riconosce le 4
        // sezioni fisse e tratta il resto come Altro.
        const allKeys = [
            "serie-a",
            "uefa-champions-league",
            "uefa-europa-league",
            "uefa-conference-league",
            "premier-league",
            "nfl",
            "nba",
            "ufc",
            "mlb",
            "pga-tour",
        ];
        const curated = allKeys.filter(isCuratedLeague).sort();
        const altro = allKeys.filter((k) => !isCuratedLeague(k)).sort();
        expect(curated).toEqual([
            "serie-a",
            "uefa-champions-league",
            "uefa-conference-league",
            "uefa-europa-league",
        ]);
        expect(altro).toEqual(["mlb", "nba", "nfl", "pga-tour", "premier-league", "ufc"]);
    });
});

function makeEvent(partial: Partial<SportEvent>): SportEvent {
    return {
        id: "evt",
        title: "Team A vs. Team B",
        sport: "soccer",
        league: { key: "serie-a", name: "Serie A", sport: "soccer", kind: "league" },
        teams: { home: { name: "Team A", key: "team-a" }, away: { name: "Team B", key: "team-b" } },
        status: "upcoming",
        raw: {},
        ...partial,
    };
}

describe("sports: applyPrefs", () => {
    const prefs: SportPrefs = {
        favoriteTeams: [{ name: "Team A", key: "team-a" }],
        hiddenLeagues: ["efl-cup"],
    };

    it("filters out hidden leagues", () => {
        const events = [
            makeEvent({
                id: "1",
                league: { key: "efl-cup", name: "EFL Cup", sport: "soccer", kind: "cup" },
                teams: { home: { name: "Team C", key: "team-c" } },
            }),
            makeEvent({ id: "2", league: { key: "serie-a", name: "Serie A", sport: "soccer", kind: "league" } }),
        ];
        const result = applyPrefs(events, prefs);
        expect(result.map((e) => e.id)).toEqual(["2"]);
    });

    it("keeps favorite team events even if league is hidden", () => {
        const events = [
            makeEvent({
                id: "1",
                league: { key: "efl-cup", name: "EFL Cup", sport: "soccer", kind: "cup" },
                teams: { home: { name: "Team A", key: "team-a" } },
            }),
        ];
        const result = applyPrefs(events, prefs);
        expect(result.map((e) => e.id)).toEqual(["1"]);
    });
});

describe("sports: orderEventsByPriority", () => {
    it("puts favorite team events first, then live", () => {
        const prefs: SportPrefs = { favoriteTeams: [{ name: "Team A", key: "team-a" }], hiddenLeagues: [] };
        const favUpcoming = makeEvent({ id: "fav", teams: { home: { name: "Team A", key: "team-a" } }, status: "upcoming" });
        const otherLive = makeEvent({ id: "live", teams: { home: { name: "Team C", key: "team-c" } }, status: "live" });
        const otherUpcoming = makeEvent({ id: "other", teams: { home: { name: "Team D", key: "team-d" } }, status: "upcoming" });

        const result = orderEventsByPriority([otherUpcoming, otherLive, favUpcoming], prefs);
        expect(result[0].id).toBe("fav");
        expect(result[1].id).toBe("live");
        expect(result[2].id).toBe("other");
    });
});

describe("sports: makeFavoriteTeam", () => {
    it("normalizes a team name", () => {
        expect(makeFavoriteTeam("  Inter Milan  ")).toEqual({ name: "Inter Milan", key: "inter-milan" });
    });
});

describe("sports: mapSportEventToMeta", () => {
    it("maps an event to a StremioMeta", () => {
        const meta = mapSportEventToMeta(makeEvent({ id: "evt-1", status: "replay" }));
        expect(meta?.id).toBe("pplus:sport:evt-1");
        expect(meta?.name).toBe("Team A vs. Team B");
        expect(meta?.description).toContain("Replay");
    });

    it("returns null for missing id or title", () => {
        expect(mapSportEventToMeta(makeEvent({ id: "" }))).toBeNull();
    });
});

describe("catalogs: Altro grouping (CURATED_LEAGUE_KEYS)", () => {
    it("includes Serie A, UEFA Champions League, UEFA Europa League and UEFA Conference League", () => {
        expect(CURATED_LEAGUE_KEYS.has("serie-a")).toBe(true);
        expect(CURATED_LEAGUE_KEYS.has("uefa-champions-league")).toBe(true);
        expect(CURATED_LEAGUE_KEYS.has("uefa-europa-league")).toBe(true);
        expect(CURATED_LEAGUE_KEYS.has("uefa-conference-league")).toBe(true);
    });

    it("treats non-curated leagues as 'Altro'", () => {
        expect(isCuratedLeague("serie-a")).toBe(true);
        expect(isCuratedLeague("uefa-champions-league")).toBe(true);
        expect(isCuratedLeague("uefa-europa-league")).toBe(true);
        expect(isCuratedLeague("uefa-conference-league")).toBe(true);
        expect(isCuratedLeague("premier-league")).toBe(false);
        expect(isCuratedLeague("nba")).toBe(false);
        expect(isCuratedLeague("efl-cup")).toBe(false);
        expect(isCuratedLeague("")).toBe(false);
    });

    it("filters events into curated sections vs Altro via isCuratedLeague", () => {
        const all = [
            makeEvent({ id: "sa", league: { key: "serie-a", name: "Serie A", sport: "soccer", kind: "league" } }),
            makeEvent({ id: "ucl", league: { key: "uefa-champions-league", name: "UCL", sport: "soccer", kind: "cup" } }),
            makeEvent({ id: "uel", league: { key: "uefa-europa-league", name: "UEL", sport: "soccer", kind: "cup" } }),
            makeEvent({ id: "uecl", league: { key: "uefa-conference-league", name: "UECL", sport: "soccer", kind: "cup" } }),
            makeEvent({ id: "epl", league: { key: "premier-league", name: "EPL", sport: "soccer", kind: "league" } }),
            makeEvent({ id: "nba", league: { key: "nba", name: "NBA", sport: "basketball", kind: "league" } }),
        ];

        const curated = all.filter((e) => isCuratedLeague(e.league.key));
        const altro = all.filter((e) => !isCuratedLeague(e.league.key));

        expect(curated.map((e) => e.id).sort()).toEqual(["sa", "ucl", "uecl", "uel"]);
        expect(altro.map((e) => e.id).sort()).toEqual(["epl", "nba"]);
    });
});
