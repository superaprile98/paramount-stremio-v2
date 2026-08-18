import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { parsePplusId } from "@/lib/paramount/mapping";
import { safeDecode, stripJsonSuffix } from "@/lib/paramount/utils";
import { buildSportMeta } from "@/lib/paramount/types/sports";
import { buildLiveMeta } from "@/lib/paramount/types/live";
import { buildMovieMeta, buildSeriesMeta } from "@/lib/paramount/types/vod";

export const runtime = "nodejs";

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id?: string[] }> }
) {
    const { key, type, id } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return NextResponse.json({ meta: null }, { status: 200 });

    const cleaned = stripJsonSuffix(String(id));
    const decoded = safeDecode(cleaned);

    const parsed = parsePplusId(decoded);

    if (parsed.kind === "sport" && type === "tv") {
        const meta = await buildSportMeta(session, parsed.key);
        return NextResponse.json({ meta }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (parsed.kind === "live" && type === "tv") {
        const meta = await buildLiveMeta(session, parsed.key);
        return NextResponse.json({ meta }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (parsed.kind === "movie" && type === "movie") {
        const meta = await buildMovieMeta(session, parsed.key);
        return NextResponse.json({ meta }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (parsed.kind === "series" && type === "series") {
        const meta = await buildSeriesMeta(session, parsed.key);
        return NextResponse.json({ meta }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    return NextResponse.json({ meta: null }, { status: 200 });
}