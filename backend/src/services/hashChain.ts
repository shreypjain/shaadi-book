/**
 * Hash-chain helpers for the append-only transaction ledger.
 *
 * Each transaction row stores:
 *   prevHash  — txHash of the immediately preceding row ("0"×64 for the first row)
 *   txHash    — SHA-256(prevHash | type | amount | userId | createdAt ISO-8601)
 *
 * A background worker (Task 2.3) walks the chain and alerts on any mismatch.
 *
 * Reference: PRD §7.4 — Cryptographic audit trail
 */

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Re-export the Prisma-generated transaction client type for use across
// service files.  This type is compatible with both the full PrismaClient
// and the sub-client supplied inside $transaction callbacks.
// ---------------------------------------------------------------------------

export type PrismaLike = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// computeHash
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash for a single transaction row.
 *
 * The input string is the pipe-delimited concatenation of all fields so that
 * changing any single field breaks every subsequent hash in the chain.
 *
 * @param prevHash  - txHash of the previous row (or "0"×64 for the genesis row).
 * @param type      - TransactionType enum value as a string (e.g. "PURCHASE").
 * @param amount    - Serialised amount, always 6 decimal places (e.g. "10.000000").
 * @param userId    - UUID of the transacting user.
 * @param createdAt - Exact timestamp written to the row.
 * @returns 64-character lowercase hex SHA-256 digest.
 */
export function computeHash(
  prevHash: string,
  type: string,
  amount: string,
  userId: string,
  createdAt: Date
): string {
  const raw = [prevHash, type, amount, userId, createdAt.toISOString()].join(
    "|"
  );
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// getLastHash
// ---------------------------------------------------------------------------

/**
 * Return the txHash of the most-recently inserted transaction row, or a
 * genesis value of 64 zeroes when the table is empty.
 *
 * Must be called inside the same database transaction as the subsequent
 * INSERT to guarantee linearisation.
 *
 * @param db - Prisma transaction client (or full PrismaClient — compatible).
 * @returns 64-character hex string.
 */
export async function getLastHash(db: PrismaLike): Promise<string> {
  const last = await db.transaction.findFirst({
    orderBy: { createdAt: "desc" },
    select: { txHash: true },
  });
  return last?.txHash ?? "0".repeat(64);
}
