/**
 * Hash Chain Verifier — PRD §7.4 + §9 (rule 11)
 *
 * Verifies the SHA-256 hash chain that protects the immutable transaction
 * ledger from tampering. Any modification to a historical row will break
 * the chain and is immediately detectable.
 *
 * Usage:
 *   verifyChainIntegrity()           — one-shot check, returns result object
 *   startIntegrityMonitor(60_000)    — background polling (runs every 60 s)
 *
 * On failure:
 *   - CRITICAL log emitted
 *   - Optional onFailure callback invoked (e.g. send admin SMS via Twilio)
 *   - PRD §9 rule 11: all purchasing should be halted; caller is responsible
 *     for that gate (e.g. set a READ_ONLY flag on the process).
 */

import { prisma } from "../db.js";
import { computeHash } from "./hashChain.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ChainIntegrityResult {
  /** true = all hashes verified, false = tampering or corruption detected */
  valid: boolean;
  /** Number of transaction rows checked */
  totalChecked: number;
  /** UUID of the first row where the chain breaks (if any) */
  brokenAtId?: string;
  /** 0-based index of the broken row in the ordered chain (if any) */
  brokenAtSequence?: number;
  /** Human-readable description of the failure (if any) */
  error?: string;
}

// ---------------------------------------------------------------------------
// verifyChainIntegrity
// ---------------------------------------------------------------------------

/**
 * Read all transaction rows in insertion order and verify each SHA-256 hash.
 *
 * Two checks per row:
 *   1. prevHash must equal the txHash of the immediately preceding row.
 *   2. txHash must equal SHA256(prevHash | type | amount | userId | createdAt).
 *
 * If either check fails, returns { valid: false, brokenAtId, ... }.
 *
 * NOTE: Fetches all rows into memory. Fine at wedding scale (< 10k rows).
 */
export async function verifyChainIntegrity(): Promise<ChainIntegrityResult> {
  const transactions = await prisma.transaction.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      type: true,
      amount: true,
      prevHash: true,
      txHash: true,
      createdAt: true,
    },
  });

  if (transactions.length === 0) {
    return { valid: true, totalChecked: 0 };
  }

  const GENESIS_HASH = "0".repeat(64);
  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]!;

    // Check 1: prevHash must chain from the previous row.
    if (tx.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalChecked: i,
        brokenAtId: tx.id,
        brokenAtSequence: i,
        error:
          `prevHash mismatch at sequence ${i} (id=${tx.id}): ` +
          `expected ${expectedPrevHash.slice(0, 16)}... ` +
          `got ${tx.prevHash.slice(0, 16)}...`,
      };
    }

    // Check 2: recompute txHash and compare.
    // amount.toFixed(6) produces the same format used at insertion time.
    const recomputed = computeHash(
      tx.prevHash,
      tx.type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx.amount as any).toFixed(6),
      tx.userId,
      tx.createdAt.toISOString()
    );

    if (recomputed !== tx.txHash) {
      return {
        valid: false,
        totalChecked: i,
        brokenAtId: tx.id,
        brokenAtSequence: i,
        error:
          `txHash mismatch at sequence ${i} (id=${tx.id}): ` +
          `stored=${tx.txHash.slice(0, 16)}... ` +
          `recomputed=${recomputed.slice(0, 16)}...`,
      };
    }

    expectedPrevHash = tx.txHash;
  }

  return { valid: true, totalChecked: transactions.length };
}

// ---------------------------------------------------------------------------
// startIntegrityMonitor
// ---------------------------------------------------------------------------

/**
 * Start a background integrity monitor that verifies the hash chain at a
 * fixed interval.
 *
 * Behavior on failure:
 *   - Emits a CRITICAL log via console.error
 *   - Calls onFailure(result) if provided — use this to trigger admin alerts
 *     (e.g. Twilio SMS, admin panel notification)
 *
 * @param intervalMs  - Poll interval in milliseconds (default 60_000 = 60 s)
 * @param onFailure   - Optional callback invoked when the chain is broken
 * @returns           - NodeJS.Timeout handle; call clearInterval() to stop
 */
export function startIntegrityMonitor(
  intervalMs = 60_000,
  onFailure?: (result: ChainIntegrityResult) => void
): NodeJS.Timeout {
  return setInterval(() => {
    verifyChainIntegrity()
      .then((result) => {
        if (!result.valid) {
          console.error(
            "[ledger] CRITICAL: Hash chain integrity FAILED — possible tampering!",
            result
          );
          onFailure?.(result);
        } else {
          console.info(
            `[ledger] Hash chain OK — ${result.totalChecked} transactions verified.`
          );
        }
      })
      .catch((err: unknown) => {
        console.error("[ledger] Hash chain integrity check threw:", err);
      });
  }, intervalMs);
}
