/**
 * E2E Auth Helpers — e2e/helpers/auth.ts
 *
 * Utilities for:
 *  1. Creating test users directly in the DB (bypasses Twilio OTP)
 *  2. Injecting JWT + user profile into browser localStorage so the
 *     Next.js frontend treats the Playwright page as authenticated.
 *  3. Minting JWTs using the same JWT_SECRET the backend uses.
 *
 * Strategy: we never touch the real Twilio flow in E2E tests.
 * Instead we:
 *   - INSERT the user row via psql (or re-use the row if already present)
 *   - Sign a JWT with jsonwebtoken + JWT_SECRET env var
 *   - Set localStorage.token + localStorage.user on the page before navigation
 */

import { execFileSync } from "child_process";
import crypto from "crypto";
import type { Page, APIRequestContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BACKEND = "http://localhost:3001";

/** Matches the DB URL used by existing sequential-sim tests */
const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://shreyjain@localhost:5432/shaadi_book";

// ---------------------------------------------------------------------------
// Input validation — applied before any value reaches a SQL statement
// ---------------------------------------------------------------------------

/** E.164 phone: + followed by 1–15 digits */
const PHONE_RE = /^\+\d{1,15}$/;

/** Standard UUID v4 format */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertPhone(phone: string): void {
  if (!PHONE_RE.test(phone)) {
    throw new Error(
      `Invalid phone number — must be E.164 (e.g. +15551234567), got: ${JSON.stringify(phone)}`
    );
  }
}

function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) {
    throw new Error(`Invalid UUID: ${JSON.stringify(id)}`);
  }
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

/**
 * Return JWT_SECRET from the environment, throwing a clear error if absent.
 * Fails fast so tests don't silently sign tokens with an empty secret.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET env var must be set for E2E tests. " +
        "Ensure it matches the backend's JWT_SECRET."
    );
  }
  return secret;
}

/**
 * Sign a JWT payload using the same secret as the backend.
 * Uses jsonwebtoken (declared as an explicit devDependency in the root package.json).
 */
export function signJwt(
  payload: { userId: string; role: string; phone: string },
  expiresIn = "2h"
): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwt = require("jsonwebtoken") as typeof import("jsonwebtoken");
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Run a psql one-liner against the local dev DB.
 *
 * Uses execFileSync (NOT execSync) so arguments are never passed through a
 * shell — this eliminates the shell-injection vector entirely.
 *
 * Pass user-supplied strings via `vars` and reference them as :'varname'
 * in the SQL.  psql's variable quoting wraps the value in single quotes and
 * escapes embedded single quotes, providing SQL-injection protection for any
 * string parameter.
 *
 * Returns trimmed stdout (useful for SELECT results).
 */
export function psql(sql: string, vars?: Record<string, string>): string {
  const args: string[] = ["-t", "-A", DB_URL, "-c", sql];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // Each -v arg is a separate element — no shell quoting needed.
      args.push("-v", `${k}=${v}`);
    }
  }
  return execFileSync("psql", args, { encoding: "utf-8" }).trim();
}

// ---------------------------------------------------------------------------
// Test user factory
// ---------------------------------------------------------------------------

export interface TestUser {
  userId: string;
  name: string;
  phone: string;
  country: "US" | "IN";
  role: "GUEST" | "ADMIN";
  token: string;
}

/**
 * Ensure a test user row exists in the DB and return a signed JWT for them.
 * Uses ON CONFLICT DO NOTHING so repeated test runs are idempotent.
 */
export function createTestUser(opts: {
  userId: string;
  name: string;
  phone: string;
  country?: "US" | "IN";
  role?: "GUEST" | "ADMIN";
}): TestUser {
  const { userId, name, phone, country = "US", role = "GUEST" } = opts;

  // Validate user-supplied inputs before they reach any SQL statement.
  assertUuid(userId);
  assertPhone(phone);

  // country and role are TypeScript-narrowed to safe enum literals — no
  // validation needed, but they are interpolated directly (not via -v) since
  // they cannot contain injection characters.
  psql(
    `INSERT INTO users (id, name, phone, country, role, created_at) ` +
      `VALUES (:'uid', :'name', :'phone', '${country}', '${role}', NOW()) ` +
      `ON CONFLICT (phone) DO NOTHING`,
    { uid: userId, name, phone }
  );

  const jwtRole = role === "ADMIN" ? "admin" : "guest";
  const token = signJwt({ userId, role: jwtRole, phone });

  return { userId, name, phone, country, role, token };
}

/**
 * Fetch the userId of an existing user by phone.
 * Returns empty string if not found.
 */
export function getUserIdByPhone(phone: string): string {
  assertPhone(phone);
  return psql(
    `SELECT COALESCE((SELECT id FROM users WHERE phone = :'phone' LIMIT 1), '')`,
    { phone }
  );
}

// ---------------------------------------------------------------------------
// Deposit helpers (ledger only — no Stripe)
// ---------------------------------------------------------------------------

/**
 * Insert a DEPOSIT transaction directly into the ledger for a test user.
 * Uses a fresh hash chain starting from the last known hash.
 *
 * This mirrors the approach used in sequential-sim.spec.ts.
 *
 * ⚠️  NOT CONCURRENCY-SAFE: The hash-chain tail is read and the new row is
 * written in two separate psql calls with no advisory lock or transaction.
 * Running this concurrently from multiple processes (e.g. parallel Playwright
 * workers) can produce colliding prev_hash values and violate the chain
 * integrity constraint.  Use only inside single-threaded setup hooks
 * (test.beforeAll / test.beforeEach with fullyParallel: false for the suite).
 */
export function creditUser(userId: string, amountCents: number, tag: string): void {
  assertUuid(userId);

  const amountDollars = (amountCents / 100).toFixed(6);

  // Get tail of hash chain
  const prevHash = psql(
    `SELECT COALESCE((SELECT tx_hash FROM transactions ORDER BY created_at DESC LIMIT 1), '${"0".repeat(64)}')`
  );

  const now = new Date().toISOString();
  const txHash = crypto
    .createHash("sha256")
    .update(`${prevHash}|DEPOSIT|${amountDollars}|${userId}|${now}`)
    .digest("hex");

  // userId is validated above and passed via -v / :'uid' for SQL-injection
  // safety.  The remaining values are computed internally (hex hashes,
  // fixed-precision decimal, ISO timestamp) and are safe to interpolate.
  psql(
    `INSERT INTO transactions (id, user_id, debit_account, credit_account, type, amount, prev_hash, tx_hash, stripe_session_id, created_at) ` +
      `VALUES (` +
      `gen_random_uuid(), ` +
      `:'uid', ` +
      `'stripe', ` +
      `'user:' || :'uid', ` +
      `'DEPOSIT', ` +
      `${amountDollars}, ` +
      `'${prevHash}', ` +
      `'${txHash}', ` +
      `'e2e_${tag}', ` +
      `'${now}'` +
      `)`,
    { uid: userId }
  );
}

// ---------------------------------------------------------------------------
// Browser auth injection
// ---------------------------------------------------------------------------

/**
 * Inject a JWT + user profile into browser localStorage before navigation.
 *
 * Call this before page.goto() or after page.goto('/login') to authenticate
 * the page without going through the OTP flow.
 *
 * The keys written here must match what frontend/lib/auth.ts reads:
 *   - localStorage["token"]  → raw JWT string
 *   - localStorage["user"]   → JSON-serialised user profile
 */
export async function injectAuthState(
  page: Page,
  user: TestUser
): Promise<void> {
  // Navigate to /login first so we're on the right origin
  await page.goto("/login");
  await page.evaluate(
    ({ token, profile }) => {
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(profile));
    },
    {
      token: user.token,
      profile: {
        id: user.userId,
        name: user.name,
        phone: user.phone,
        country: user.country,
        role: user.role.toLowerCase(),
      },
    }
  );
}

// ---------------------------------------------------------------------------
// tRPC helpers (same pattern as existing E2E specs)
// ---------------------------------------------------------------------------

export async function trpcQuery(
  request: APIRequestContext,
  proc: string,
  input?: unknown,
  token?: string
): Promise<unknown> {
  const url = input
    ? `${BACKEND}/trpc/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${BACKEND}/trpc/${proc}`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await request.get(url, { headers });
  return res.json();
}

export async function trpcMutate(
  request: APIRequestContext,
  proc: string,
  input: unknown,
  token?: string
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await request.post(`${BACKEND}/trpc/${proc}`, {
    headers,
    data: input,
  });
  return res.json();
}
