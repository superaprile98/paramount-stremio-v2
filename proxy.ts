import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  // Log only the pathname — never the query string, which may contain
  // session keys (key), upstream tokens (t) or proxied URLs (u).
  console.log(`${request.method} ${request.nextUrl.pathname}`);
  return NextResponse.next();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
