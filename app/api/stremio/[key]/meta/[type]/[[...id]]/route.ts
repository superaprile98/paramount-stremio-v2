import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { parsePplusId } from "@/lib/paramount/mapping";
import { safeDecode, stripJsonSuffix } from "@/lib/paramount/utils";
import { findSportEvent, mapSportEventToMeta } from "@/lib/paramount/sports";
import { buildLiveMeta } from "@/lib/paramount/live";
import { withCors } from "@/lib/stremio/cors";

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

    if (parsed.kind === "sport" && (type === "tv" || type === "sport")) {
        const event = await findSportEvent(session, parsed.key);
        const meta = event ? mapSportEventToMeta(event) : null;
        return withCors(NextResponse.json({ meta }));
    }

    if (parsed.kind === "live" && type === "tv") {
        const meta = await buildLiveMeta(session, parsed.key);
        return withCors(NextResponse.json({ meta }));
    }

    return withCors(NextResponse.json({ meta: null }));
}