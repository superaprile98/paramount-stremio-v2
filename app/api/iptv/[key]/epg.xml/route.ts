import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { getLiveListing } from "@/lib/paramount/types/live";
import { getSportListing } from "@/lib/paramount/types/sports";
import { IptvChannel, mapLiveChannel, mapSportChannel, xmlEscape, xmlTvDate, tvgId, tvgSportId } from "@/lib/paramount/iptv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const [liveListings, sportListings] = await Promise.all([
        getLiveListing(session),
        getSportListing(session, false),
    ]);

    const liveChannels = liveListings.map(mapLiveChannel).filter((ch): ch is IptvChannel => ch !== null);
    const sportChannels = sportListings.map(mapSportChannel).filter((ch): ch is IptvChannel => ch !== null);

    const parts: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv generator-info-name="paramount-stremio">',
    ];

    for (const ch of liveChannels) {
        parts.push(`  <channel id="${xmlEscape(tvgId(ch.slug))}">`);
        parts.push(`    <display-name>${xmlEscape(ch.name)}</display-name>`);
        if (ch.logo) parts.push(`    <icon src="${xmlEscape(ch.logo)}" />`);
        parts.push("  </channel>");
    }

    for (const ch of sportChannels) {
        parts.push(`  <channel id="${xmlEscape(tvgSportId(ch.slug))}">`);
        parts.push(`    <display-name>${xmlEscape(ch.name)}</display-name>`);
        if (ch.logo) parts.push(`    <icon src="${xmlEscape(ch.logo)}" />`);
        parts.push("  </channel>");
    }

    for (const ch of liveChannels) {
        for (const p of ch.programs) {
            const start = xmlTvDate(p.startTimestamp);
            const end = xmlTvDate(p.endTimestamp);
            if (!start || !end) continue;
            parts.push(`  <programme start="${start}" stop="${end}" channel="${xmlEscape(tvgId(ch.slug))}">`);
            parts.push(`    <title lang="en">${xmlEscape(p.title ?? ch.name)}</title>`);
            if (p.description) parts.push(`    <desc lang="en">${xmlEscape(p.description)}</desc>`);
            parts.push("  </programme>");
        }
    }

    for (const ch of sportChannels) {
        for (const p of ch.programs) {
            const start = xmlTvDate(p.startTimestamp);
            const end = xmlTvDate(p.endTimestamp);
            if (!start || !end) continue;
            parts.push(`  <programme start="${start}" stop="${end}" channel="${xmlEscape(tvgSportId(ch.slug))}">`);
            parts.push(`    <title lang="en">${xmlEscape(p.title ?? ch.name)}</title>`);
            if (p.description) parts.push(`    <desc lang="en">${xmlEscape(p.description)}</desc>`);
            parts.push("  </programme>");
        }
    }

    parts.push("</tv>");

    return new NextResponse(parts.join("\n") + "\n", {
        headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        },
    });
}