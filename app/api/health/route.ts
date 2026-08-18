import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint di health check per orchestrazione (Docker HEALTHCHECK, load balancer).
// Non richiede autenticazione e non espone dati sensibili.
export async function GET() {
    return NextResponse.json({ status: "ok" }, { status: 200 });
}