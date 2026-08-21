import { NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { withCors, optionsCors } from "@/lib/stremio/cors";
import {
    addFavoriteTeam,
    getPrefs,
    hideLeague,
    removeFavoriteTeam,
    setPrefs,
    showLeague,
} from "@/lib/paramount/prefs";
import { getSportLeagues, makeFavoriteTeam } from "@/lib/paramount/sports";
import { SportPrefs } from "@/lib/paramount/types/sport-models";

export const runtime = "nodejs";

export function OPTIONS() { return optionsCors(); }

async function resolveSession(key: string): Promise<{ profileId: number; session: any } | null> {
    const client = new ParamountClient();
    await client.setSessionKey(key);
    const session = client.getSession();
    if (!session) return null;
    return { profileId: session.profileId ?? 0, session };
}

/** GET /api/stremio/[key]/prefs — legge le preferenze del profilo + lista leghe. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;
    const resolved = await resolveSession(key);
    if (!resolved) {
        return withCors(NextResponse.json({ error: "Invalid session" }, { status: 401 }));
    }
    const { profileId, session } = resolved;
    const prefs = getPrefs(profileId);

    // Lista delle competizioni attive (per la UI show/hide).
    let leagues: { key: string; name: string }[] = [];
    try {
        const sportLeagues = await getSportLeagues(session);
        leagues = sportLeagues.map((l) => ({ key: l.key, name: l.name }));
    } catch {
        // se il fetch fallisce, la UI mostra solo le squadre preferite
    }

    return withCors(NextResponse.json({ profileId, prefs, leagues }));
}

/** POST /api/stremio/[key]/prefs — aggiorna le preferenze del profilo. */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;
    const resolved = await resolveSession(key);
    if (!resolved) {
        return withCors(NextResponse.json({ error: "Invalid session" }, { status: 401 }));
    }
    const { profileId } = resolved;

    const body: any = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
        return withCors(NextResponse.json({ error: "Invalid body" }, { status: 400 }));
    }

    const action = body.action as string | undefined;
    let prefs: SportPrefs;

    switch (action) {
        case "set": {
            // Sostituisce l'intero oggetto preferenze.
            prefs = setPrefs(profileId, {
                favoriteTeams: Array.isArray(body.favoriteTeams) ? body.favoriteTeams : [],
                hiddenLeagues: Array.isArray(body.hiddenLeagues) ? body.hiddenLeagues : [],
            });
            break;
        }
        case "addTeam": {
            const name = typeof body.name === "string" ? body.name.trim() : "";
            if (!name) {
                return withCors(NextResponse.json({ error: "Missing team name" }, { status: 400 }));
            }
            prefs = addFavoriteTeam(profileId, makeFavoriteTeam(name));
            break;
        }
        case "removeTeam": {
            const teamKey = typeof body.teamKey === "string" ? body.teamKey : "";
            if (!teamKey) {
                return withCors(NextResponse.json({ error: "Missing teamKey" }, { status: 400 }));
            }
            prefs = removeFavoriteTeam(profileId, teamKey);
            break;
        }
        case "hideLeague": {
            const leagueKey = typeof body.leagueKey === "string" ? body.leagueKey : "";
            if (!leagueKey) {
                return withCors(NextResponse.json({ error: "Missing leagueKey" }, { status: 400 }));
            }
            prefs = hideLeague(profileId, leagueKey);
            break;
        }
        case "showLeague": {
            const leagueKey = typeof body.leagueKey === "string" ? body.leagueKey : "";
            if (!leagueKey) {
                return withCors(NextResponse.json({ error: "Missing leagueKey" }, { status: 400 }));
            }
            prefs = showLeague(profileId, leagueKey);
            break;
        }
        default:
            return withCors(NextResponse.json({ error: "Unknown action" }, { status: 400 }));
    }

    return withCors(NextResponse.json({ profileId, prefs }));
}
