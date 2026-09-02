import { NextResponse } from "next/server";
import { CONFIG_COOKIE } from "@/lib/auth/configure-auth";

/** POST /api/configure/logout — invalida il cookie di sessione. */
export async function POST() {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(CONFIG_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
}