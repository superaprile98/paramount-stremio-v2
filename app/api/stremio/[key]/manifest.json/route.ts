import { NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
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

    const catalogs: any[] = [
        {
            type: "tv",
            id: "pplus_live",
            name: "Paramount+ Live",
            extra: [{ name: "search" }, { name: "skip" }],
        },
        {
            type: "tv",
            id: "pplus_sports",
            name: "Paramount+ Sports",
            extra: [
                {
                    name: "genre",
                    isRequired: false,
                    options: ["Live", "Upcoming"],
                },
                { name: "search" },
                { name: "skip" },
            ],
        },
        {
            type: "movie",
            id: "pplus_movies",
            name: "Paramount+ Movies",
            extra: [{ name: "search" }, { name: "skip" }],
        },
        {
            type: "series",
            id: "pplus_series",
            name: "Paramount+ Series",
            extra: [{ name: "search" }, { name: "skip" }],
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
        types: ["tv", "movie", "series"],
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
