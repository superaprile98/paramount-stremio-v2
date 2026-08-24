import { NextResponse } from "next/server";
import { ParamountClient } from "@/lib/paramount/client";
import { buildManifest } from "@/lib/stremio/manifest";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) {
        return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const baseUrl = process.env.BASE_URL?.replace(/\/$/, "") ?? new URL(_req.url).origin;

    const manifest = await buildManifest(session, baseUrl);

    return NextResponse.json(manifest, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
        },
    });
}
