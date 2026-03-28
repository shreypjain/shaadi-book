/**
 * Next.js Edge Middleware — Task 4.3 + auth-ui
 *
 * Two responsibilities:
 *  1. Redirect unauthenticated visitors (no sb_token cookie) to /login.
 *  2. Redirect non-admins away from /admin/* routes.
 *
 * JWT payload is decoded client-side (base64url, no signature verification).
 * Signature verification happens server-side on every API call.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function decodeJwtPayload(token: string): { role?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = (parts[1] ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const json = atob(b64);
    return JSON.parse(json) as { role?: string };
  } catch {
    return null;
  }
}

// Routes that are always public — no token required
const PUBLIC_PATHS = ["/login", "/api"];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Always allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("sb_token")?.value;

  // Unauthenticated — redirect to login
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const payload = decodeJwtPayload(token);

  // Corrupt/unparseable token — force re-login
  if (!payload) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Admin-only routes
  if (pathname.startsWith("/admin") && payload.role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Match all routes except Next.js internals + static files
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icons/).*)",
  ],
};
