/**
 * Next.js Edge Middleware — Task 4.3
 *
 * Protects /admin/* routes by checking the sb_token cookie.
 * Decodes the JWT payload (base64url, no signature verification — that
 * happens server-side on every API call). Redirects to / if missing or
 * role !== 'admin'.
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

export function middleware(req: NextRequest): NextResponse {
  // Only protect /admin/* paths
  if (!req.nextUrl.pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const token = req.cookies.get("sb_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const payload = decodeJwtPayload(token);

  if (payload?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
