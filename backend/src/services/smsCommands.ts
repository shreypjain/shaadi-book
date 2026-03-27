/**
 * SMS Admin Commands Service — Task 5.1
 *
 * Parses and executes admin SMS commands received via Twilio.
 *
 * Command formats (PRD §6.5):
 *   NEW | Question? | Outcome1, Outcome2, ...
 *   RESOLVE | <market_id_or_number> | <winning_outcome>
 *   PAUSE | <market_id_or_number>
 *   STATUS | <market_id_or_number>
 *
 * Market references accept either a UUID or a 1-based creation-order number
 * (e.g., "7" means the 7th market created).
 */

import type { PrismaClient } from "@prisma/client";
import { isAdminPhone } from "../middleware/auth.js";
import {
  createMarket,
  resolveMarket,
  pauseMarket,
  getMarketWithPrices,
  type MarketWithPrices,
} from "./marketService.js";
import { prisma as defaultPrisma } from "../db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsedCommand =
  | { type: "NEW"; question: string; outcomes: string[] }
  | { type: "RESOLVE"; marketRef: string; winningOutcome: string }
  | { type: "PAUSE"; marketRef: string }
  | { type: "STATUS"; marketRef: string }
  | { type: "UNKNOWN"; raw: string };

const USAGE = [
  "Valid commands:",
  "  NEW | Question? | Yes, No",
  "  RESOLVE | <id> | <outcome>",
  "  PAUSE | <id>",
  "  STATUS | <id>",
].join("\n");

// ---------------------------------------------------------------------------
// parseCommand — pure, synchronous
// ---------------------------------------------------------------------------

/**
 * Parse a pipe-separated SMS body into a typed command.
 * Returns { type: "UNKNOWN" } for unrecognised or malformed input.
 */
export function parseCommand(body: string): ParsedCommand {
  const parts = body.split("|").map((s) => s.trim());
  const cmd = (parts[0] ?? "").toUpperCase();

  switch (cmd) {
    case "NEW": {
      const question = parts[1] ?? "";
      const outcomesRaw = parts[2] ?? "";
      const outcomes = outcomesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!question || outcomes.length < 2) {
        return { type: "UNKNOWN", raw: body };
      }
      return { type: "NEW", question, outcomes };
    }

    case "RESOLVE": {
      const marketRef = parts[1] ?? "";
      const winningOutcome = parts[2] ?? "";
      if (!marketRef || !winningOutcome) {
        return { type: "UNKNOWN", raw: body };
      }
      return { type: "RESOLVE", marketRef, winningOutcome };
    }

    case "PAUSE": {
      const marketRef = parts[1] ?? "";
      if (!marketRef) return { type: "UNKNOWN", raw: body };
      return { type: "PAUSE", marketRef };
    }

    case "STATUS": {
      const marketRef = parts[1] ?? "";
      if (!marketRef) return { type: "UNKNOWN", raw: body };
      return { type: "STATUS", marketRef };
    }

    default:
      return { type: "UNKNOWN", raw: body };
  }
}

// ---------------------------------------------------------------------------
// formatMarketStatus — pure, synchronous
// ---------------------------------------------------------------------------

/**
 * Format a market snapshot as a short SMS-friendly status string.
 * Example: "Market #7: 45 trades, midpoint Yes=$0.62"
 */
export function formatMarketStatus(
  market: MarketWithPrices,
  marketNum: number,
  tradesCount: number
): string {
  if (market.outcomes.length === 0) {
    return `Market #${marketNum}: ${market.status} | ${tradesCount} trades`;
  }
  const leading = market.outcomes.reduce((best, o) =>
    o.price > best.price ? o : best
  );
  return (
    `Market #${marketNum}: ${tradesCount} trades, ` +
    `midpoint ${leading.label}=$${leading.price.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return the 1-based creation-order number for a market ID. */
async function getMarketNum(marketId: string, db: PrismaClient): Promise<number> {
  const all = await db.market.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const idx = all.findIndex((m: { id: string }) => m.id === marketId);
  return idx >= 0 ? idx + 1 : all.length;
}

/**
 * Resolve a market reference (UUID string or 1-based number string) to
 * a { id, num } pair.  Returns null if no match found.
 */
async function resolveMarketRef(
  ref: string,
  db: PrismaClient
): Promise<{ id: string; num: number } | null> {
  const trimmed = ref.trim();

  // UUID format — use directly
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  ) {
    const market = await db.market.findUnique({
      where: { id: trimmed },
      select: { id: true },
    });
    if (!market) return null;
    const num = await getMarketNum(trimmed, db);
    return { id: trimmed, num };
  }

  // 1-based numeric index
  const idx = parseInt(trimmed, 10);
  if (isNaN(idx) || idx < 1) return null;

  const all = await db.market.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const market = all[idx - 1];
  if (!market) return null;
  return { id: market.id, num: idx };
}

// ---------------------------------------------------------------------------
// executeCommand — async orchestrator
// ---------------------------------------------------------------------------

/**
 * Execute an SMS admin command and return the reply text to send back.
 *
 * Security: rejects any sender not in ADMIN_PHONE_NUMBERS before touching the DB.
 */
export async function executeCommand(
  adminPhone: string,
  body: string,
  opts?: { prismaClient?: PrismaClient }
): Promise<string> {
  // 1. Verify admin authorization (fast path — no DB needed)
  if (!isAdminPhone(adminPhone)) {
    return "Unauthorized: this number is not authorized to issue admin commands.";
  }

  const db = opts?.prismaClient ?? defaultPrisma;
  const command = parseCommand(body);

  // 2. Reject unknown / malformed commands before any DB work
  if (command.type === "UNKNOWN") {
    return `Unknown command format.\n${USAGE}`;
  }

  // 3. Resolve admin user ID (required for audit logging in service functions)
  const adminUser = await db.user.findFirst({
    where: { phone: adminPhone },
    select: { id: true },
  });

  if (!adminUser) {
    return (
      "Error: Admin account not found. " +
      "Please register in the app before using SMS commands."
    );
  }

  try {
    switch (command.type) {
      // -----------------------------------------------------------------------
      case "NEW": {
        const marketId = await createMarket(
          adminUser.id,
          command.question,
          command.outcomes,
          { prismaClient: db }
        );
        const num = await getMarketNum(marketId, db);
        return (
          `Created market #${num}: "${command.question}" ` +
          `with ${command.outcomes.length} outcomes.`
        );
      }

      // -----------------------------------------------------------------------
      case "RESOLVE": {
        const ref = await resolveMarketRef(command.marketRef, db);
        if (!ref) {
          return `Error: Market "${command.marketRef}" not found.`;
        }

        // Find outcome by label (case-insensitive)
        const outcome = await db.outcome.findFirst({
          where: {
            marketId: ref.id,
            label: { equals: command.winningOutcome, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (!outcome) {
          return (
            `Error: Outcome "${command.winningOutcome}" ` +
            `not found in market #${ref.num}.`
          );
        }

        // Count positions on the winning outcome before resolution
        const winnerCount = await db.position.count({
          where: { marketId: ref.id, outcomeId: outcome.id },
        });

        await resolveMarket(adminUser.id, ref.id, outcome.id, {
          prismaClient: db,
        });

        return (
          `Resolved market #${ref.num}. ` +
          `Winner: ${command.winningOutcome}. ` +
          `${winnerCount} users paid out.`
        );
      }

      // -----------------------------------------------------------------------
      case "PAUSE": {
        const ref = await resolveMarketRef(command.marketRef, db);
        if (!ref) {
          return `Error: Market "${command.marketRef}" not found.`;
        }
        await pauseMarket(adminUser.id, ref.id, { prismaClient: db });
        return `Market #${ref.num} paused. No new orders accepted.`;
      }

      // -----------------------------------------------------------------------
      case "STATUS": {
        const ref = await resolveMarketRef(command.marketRef, db);
        if (!ref) {
          return `Error: Market "${command.marketRef}" not found.`;
        }
        const market = await getMarketWithPrices(ref.id, db);
        if (!market) {
          return `Error: Market #${ref.num} data unavailable.`;
        }
        const tradesCount = await db.purchase.count({
          where: { marketId: ref.id },
        });
        return formatMarketStatus(market, ref.num, tradesCount);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return `Error: ${msg}`;
  }
}
