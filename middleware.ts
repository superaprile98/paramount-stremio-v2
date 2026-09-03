import { NextRequest, NextResponse } from "next/server";
import { BROWSER_COOKIE, CONFIG_COOKIE, verifyConfigureSession } from "@/lib/auth/configure-auth";

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
 * Inoltre emette il cookie `vpn_browser_id` (identità per-browser usata come
 * chiave dello storage VLESS): generato lato server PRIMA di qualsiasi render
 * così le fetch del primo render lo includono già.
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

    const session = await verifyConfigureSession(req.cookies.get(CONFIG_COOKIE)?.value);
    if (!session && !isLoginPage && !isPublicApi) {
        if (pathname.startsWith("/api/")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        return NextResponse.redirect(new URL("/configure/login", req.url));
    }

    const res = NextResponse.next();
    if (!req.cookies.get(BROWSER_COOKIE)?.value) {
        // 32 caratteri hex (UUID senza trattini): sicuro come nome di directory
        res.cookies.set(BROWSER_COOKIE, crypto.randomUUID().replace(/-/g, ""), {
            path: "/",
            maxAge: 365 * 24 * 60 * 60, // 1 anno
            sameSite: "lax",
            httpOnly: true,
        });
    }
    return res;
}

export const config = {
    matcher: ["/configure/:path*", "/api/vpn/:path*", "/api/configure/:path*"],
};