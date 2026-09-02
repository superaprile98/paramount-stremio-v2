import { NextRequest, NextResponse } from "next/server";
import { CONFIG_COOKIE, verifyConfigureSession } from "@/lib/auth/configure-auth";

/**
 * Middleware di protezione per /configure e le sue API.
 *
 * Percorsi protetti:
 * - /configure/** (pagina) → redirect a /configure/login se non autenticati
 * - /api/vpn/** e /api/configure/** → 401 JSON se non autenticati
 *
 * Eccezioni pubbliche: /configure/login, /api/configure/login,
 * /api/configure/session, /api/configure/logout.
 *
 * La verifica JWE usa jose + crypto.subtle: compatibile con Edge runtime.
 */
export async function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    const isLoginPage = pathname === "/configure/login";
    const isPublicApi =
        pathname === "/api/configure/login" ||
        pathname === "/api/configure/session" ||
        pathname === "/api/configure/logout";
    if (isLoginPage || isPublicApi) return NextResponse.next();

    const session = await verifyConfigureSession(req.cookies.get(CONFIG_COOKIE)?.value);
    if (session) return NextResponse.next();

    if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/configure/login", req.url);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/configure/:path*", "/api/vpn/:path*", "/api/configure/:path*"],
};