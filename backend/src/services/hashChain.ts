/**
 * SHA-256 hash chain for the append-only transaction ledger — PRD §7.4
 *
 * Each Transaction row stores:
 *   prevHash  — txHash of the immediately preceding row (or '0'.repeat(64) for the first)
 *   txHash    — SHA256(prevHash + "|" + type + "|" + amount + "|" + userId + "|" + createdAt)
 *
 * Any tampering with a historical row breaks the chain and is immediately detectable.
 * A background worker verifies chain integrity every 60 s (Task 2.3).
 */

import { createHash } from "node:crypto";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal client interface required by getLastHash (works for tx or prisma). */
type HashChainClient = {
  transaction: {
    findFirst: (args: {
      orderBy: { createdAt: "desc" };
      select: { txHash: true };
    }) => Promise<{ txHash: string } | null>;
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a transaction's hash given the chain inputs.
 *
 * Fields are concatenated with "|" as a delimiter to prevent ambiguity between
 * adjacent fields (e.g. prevHash ending in "0" and type starting with "P").
 *
 * @param prevHash  - txHash of the immediately preceding transaction (64 hex chars)
 * @param type      - TransactionType string, e.g. "PURCHASE"
 * @param amount    - Amount as a decimal string (e.g. "10.000000")
 * @param userId    - UUID of the user involved
 * @param createdAt - ISO-8601 timestamp string, e.g. "2026-03-27T12:00:00.000Z"
 * @returns 64-char lowercase hex SHA-256 digest
 */
export function computeHash(
  prevHash: string,
  type: string,
  amount: string,
  userId: string,
  createdAt: string
): string {
  const data = `${prevHash}|${type}|${amount}|${userId}|${createdAt}`;
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Retrieve the most recent transaction's txHash to use as prevHash for the
 * next transaction.
 *
 * Must be called INSIDE a transaction (pass `tx`) to avoid a race condition
 * where a concurrent write inserts a transaction between the lookup and the
 * INSERT. Serializable isolation + FOR UPDATE on outcomes ensures only one
 * writer proceeds at a time, but calling inside the tx is belt-and-suspenders.
 *
 * @param client - Prisma transaction client (or the main prisma client in tests)
 * @returns 64-char hex prevHash, or '0'.repeat(64) if the ledger is empty
 */
export async function getLastHash(
  client: HashChainClient = prisma as HashChainClient
): Promise<string> {
  const last = await client.transaction.findFirst({
    orderBy: { createdAt: "desc" },
    select: { txHash: true },
  });
  return last?.txHash ?? "0".repeat(64);
}
