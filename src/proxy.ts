import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth check: signed-out visitors to account/admin pages get a real redirect to /login.
 * This only looks for the session cookie; every page and server action still verifies the session
 * (and the admin role) on the server.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/rentals/:path*", "/profile/:path*", "/checkout/:path*", "/admin/:path*"],
};
