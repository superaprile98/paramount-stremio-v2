import { NextRequest, NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { getLiveListing } from "@/lib/paramount/types/live";
import { getSportListing } from "@/lib/paramount/types/sports";
import { IptvChannel, mapLiveChannel, mapSportChannel, m3uAttrEscape, tvgId, tvgSportId } from "@/lib/paramount/iptv";
import { guessBaseUrl } from "@/lib/paramount/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const baseUrl = guessBaseUrl(req);
    const streamBase = `${baseUrl}/api/stremio/${encodeURIComponent(key)}/stream/tv`;

    const [liveListings, sportListings] = await Promise.all([
        getLiveListing(session),
        getSportListing(session, false),
    ]);

    const liveChannels = liveListings.map(mapLiveChannel).filter((ch): ch is IptvChannel => ch !== null);
    const sportChannels = sportListings.map(mapSportChannel).filter((ch): ch is IptvChannel => ch !== null);

    const lines: string[] = ["#EXTM3U"];

    for (const ch of liveChannels) {
        const group = m3uAttrEscape(ch.group ?? "Paramount+ Live");
        const name = m3uAttrEscape(ch.name);
        const logo = ch.logo ? ` tvg-logo="${m3uAttrEscape(ch.logo)}"` : "";
        lines.push(`#EXTINF:-1 tvg-id="${tvgId(ch.slug)}" tvg-name="${name}" group-title="${group}"${logo},${name}`);
        lines.push(`${streamBase}/${encodeURIComponent(`pplus:live:${ch.slug}`)}.json`);
    }

    for (const ch of sportChannels) {
        const group = m3uAttrEscape(ch.group ?? "Paramount+ Sports");
        const name = m3uAttrEscape(ch.name);
        const logo = ch.logo ? ` tvg-logo="${m3uAttrEscape(ch.logo)}"` : "";
        lines.push(`#EXTINF:-1 tvg-id="${tvgSportId(ch.slug)}" tvg-name="${name}" group-title="${group}"${logo},${name}`);
        lines.push(`${streamBase}/${encodeURIComponent(`pplus:sport:${ch.slug}`)}.json`);
    }

    const body = lines.join("\n") + "\n";

    return new NextResponse(body, {
        headers: {
            "Content-Type": "audio/x-mpegurl; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        },
    });
}