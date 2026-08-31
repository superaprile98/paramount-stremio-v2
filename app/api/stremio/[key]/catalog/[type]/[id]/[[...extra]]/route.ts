import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { getCatalogMetas } from "@/lib/paramount/sports";
import { safeDecode } from "@/lib/paramount/utils";
import { withCors } from "@/lib/stremio/cors";

export const runtime = "nodejs";

function parseExtras(extra?: string[]) {
    const out: Record<string, string> = {};
    for (const seg of extra ?? []) {
        const i = seg.indexOf("=");
        if (i === -1) continue;
        out[safeDecode(seg.slice(0, i))] = safeDecode(seg.slice(i + 1));
    }
    const rawGenre = out.genre ? out.genre.replace('.json', '') : undefined;
    return {
        search: out.search ? out.search.replace('.json', '') : "",
        skip: out.skip ? Number(out.skip.replace('.json', '')) : 0,
        // genre: "Tutte" (default) oppure il nome di una lega dal dropdown.
        genre: rawGenre,
    };
}

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ key: string; type: string; id: string; extra?: string[] }> }
) {
    const { key, type, id, extra } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return NextResponse.json({ metas: [] });

    const parsed = parseExtras(extra);
    const metas = await getCatalogMetas({
        type,
        id,
        session,
        extra: parsed,
    });

    return withCors(NextResponse.json({ metas }));
}
