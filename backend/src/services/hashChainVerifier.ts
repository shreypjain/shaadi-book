/**
 * Hash Chain Verifier — Task 2.3
 *
 * Iterates all transaction rows in insertion order and recomputes every SHA-256
 * hash to detect any tampering. Runs as a background interval (default 60 s).
 *
 * If the chain is broken, it means a row was mutated outside the trigger
 * (e.g. direct superuser access). The system should enter read-only mode and
 * alert the admin.
 *
 * References:
 *   PRD §7.4 — Cryptographic audit trail
 *   PRD §9   — Ledger corruption recovery (rule #11)
 */

import { computeTxHash, GENESIS_HASH } from "./ledger.js";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Chain integrity result
// ---------------------------------------------------------------------------

export interface ChainIntegrityResult {
  /** True when every hash in the chain recomputes correctly. */
  valid: boolean;
  /** Number of transactions examined. */
  checkedCount: number;
  /** ID of the first transaction whose hash does not match, if any. */
  firstBadTransactionId?: string;
  /** Human-readable description of the failure, if any. */
  error?: string;
  checkedAt: Date;
}

// ---------------------------------------------------------------------------
// verifyChainIntegrity
// ---------------------------------------------------------------------------

/**
 * Fetch all transactions in canonical order and recompute every txHash.
 *
 * Canonical order: created_at ASC, id ASC (stable tiebreaker for same-ms txns).
 *
 * For each row the verifier checks two things:
 *  1. The stored prevHash equals the txHash of the preceding row
 *     (or GENESIS_HASH for the first row).
 *  2. The stored txHash equals recompute(prevHash, type, amount, userId, createdAt).
 *
 * @returns ChainIntegrityResult — valid=true if the chain is intact.
 */
export async function verifyChainIntegrity(): Promise<ChainIntegrityResult> {
  const checkedAt = new Date();

  // Fetch in canonical order. We only need the fields used by computeTxHash.
  const transactions = await prisma.transaction.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      type: true,
      amount: true,
      userId: true,
      createdAt: true,
      prevHash: true,
      txHash: true,
    },
  });

  if (transactions.length === 0) {
    return { valid: true, checkedCount: 0, checkedAt };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (const tx of transactions) {
    // 1. Verify prevHash links correctly.
    if (tx.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        checkedCount: transactions.indexOf(tx),
        firstBadTransactionId: tx.id,
        error: `prevHash mismatch at transaction ${tx.id}: expected ${expectedPrevHash}, got ${tx.prevHash}`,
        checkedAt,
      };
    }

    // 2. Recompute and verify stored txHash.
    const recomputed = computeTxHash(
      tx.prevHash,
      tx.type,
      tx.amount,
      tx.userId,
      tx.createdAt
    );

    if (recomputed !== tx.txHash) {
      return {
        valid: false,
        checkedCount: transactions.indexOf(tx),
        firstBadTransactionId: tx.id,
        error: `txHash mismatch at transaction ${tx.id}: stored ${tx.txHash}, recomputed ${recomputed}`,
        checkedAt,
      };
    }

    expectedPrevHash = tx.txHash;
  }

  return { valid: true, checkedCount: transactions.length, checkedAt };
}

// ---------------------------------------------------------------------------
// startIntegrityMonitor
// ---------------------------------------------------------------------------

/** Callback invoked when the monitor detects a broken chain. */
export type IntegrityAlertHandler = (result: ChainIntegrityResult) => void;

const defaultAlertHandler: IntegrityAlertHandler = (result) => {
  // In production: fire a PagerDuty/Twilio alert.
  console.error(
    "[ALERT][HashChain] Integrity violation detected — system should halt purchases!",
    JSON.stringify({
      firstBadTransactionId: result.firstBadTransactionId,
      error: result.error,
      checkedAt: result.checkedAt,
    })
  );
};

/**
 * Start a background integrity monitor.
 *
 * Checks chain integrity every `intervalMs` milliseconds (default 60 000 ms).
 * Calls `onAlert` (defaulting to console.error) when the chain is invalid.
 *
 * @param intervalMs  - Check interval in milliseconds. Default 60 000 (1 min).
 * @param onAlert     - Optional custom alert handler.
 * @returns A cleanup function that stops the interval.
 */
export function startIntegrityMonitor(
  intervalMs = 60_000,
  onAlert: IntegrityAlertHandler = defaultAlertHandler
): () => void {
  const timer = setInterval(() => {
    verifyChainIntegrity()
      .then((result) => {
        if (!result.valid) {
          onAlert(result);
        } else {
          console.info(
            `[HashChain] Integrity OK — ${result.checkedCount} transactions verified at ${result.checkedAt.toISOString()}`
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[HashChain] Monitor error during integrity check:", err);
      });
  }, intervalMs);

  // Run an immediate check on startup.
  verifyChainIntegrity()
    .then((result) => {
      if (!result.valid) {
        onAlert(result);
      } else {
        console.info(
          `[HashChain] Startup integrity check OK — ${result.checkedCount} transactions verified`
        );
      }
    })
    .catch((err: unknown) => {
      console.error("[HashChain] Startup integrity check error:", err);
    });

  return () => clearInterval(timer);
}
