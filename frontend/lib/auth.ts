/**
 * Auth helpers — Task 4.3
 *
 * JWT token storage in localStorage + a short-lived cookie so that
 * Next.js Edge middleware can read the role without hitting the DB.
 */

const TOKEN_KEY = "sb_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/** Read the stored JWT from localStorage (browser only). */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** Persist JWT to localStorage and set a same-site cookie for middleware. */
export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  document.cookie = `${TOKEN_KEY}=${token}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Clear JWT from localStorage and expire the middleware cookie. */
export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
}

/**
 * Decode the JWT payload (base64url) without verifying the signature.
 * Verification happens server-side on every API call via the backend middleware.
 */
export function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract role from a JWT ('admin' | 'guest' | null). */
export function getRole(token: string): string | null {
  const payload = decodePayload(token);
  return typeof payload?.role === "string" ? payload.role : null;
}
