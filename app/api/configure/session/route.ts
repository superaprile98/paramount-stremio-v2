import { NextRequest, NextResponse } from "next/server";
import {
    CONFIG_COOKIE,
    isConfigureAuthConfigured,
    verifyConfigureSession,
} from "@/lib/auth/configure-auth";

/**
 * GET /api/configure/session — stato auth per la UI.
 * Pubblico: espone solo { authenticated, user, configured }.
 */
export async function GET(req: NextRequest) {
    const session = await verifyConfigureSession(req.cookies.get(CONFIG_COOKIE)?.value);
    return NextResponse.json({
        authenticated: Boolean(session),
        user: session?.u ?? null,
        configured: isConfigureAuthConfigured(),
    });
}