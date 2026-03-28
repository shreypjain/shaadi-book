/**
 * Immutable Ledger Service — Task 2.3
 *
 * Append-only transaction ledger with SHA-256 hash chain.
 *
 * Accounting convention (double-entry, from house perspective):
 *   DEPOSIT:     debit=house_amm,   credit=user:{id}        → user balance +
 *   PURCHASE:    debit=user:{id},   credit=house_amm        → user balance -
 *   PAYOUT:      debit=house_amm,   credit=user:{id}        → user balance +
 *   CHARITY_FEE: debit=house_amm,   credit=charity_pool     → charity pool +
 *   WITHDRAWAL:  debit=user:{id},   credit=withdrawal:{ref} → user balance -
 *   REFUND:      debit=house_amm,   credit=user:{id}        → user balance +
 *
 * User balance = SUM(amount WHERE creditAccount='user:{id}')
 *              - SUM(amount WHERE debitAccount='user:{id}')
 *
 * Reconciliation invariant:
 *   SUM(user balances) + SUM(charity_fees) + SUM(withdrawals) + house_pool = SUM(deposits)
 *   where house_pool >= 0 (ensures solvency).
 *
 * References:
 *   PRD §7.4 — Immutable Ledger Guarantees
 */

import { createHash } from "crypto";
import { Decimal } from "decimal.js";
import type { Prisma, Transaction, TransactionType } from "@prisma/client";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SHA-256 hash of all zeros — used as the prevHash for the very first tx. */
export const GENESIS_HASH = "0".repeat(64);

// ---------------------------------------------------------------------------
// Hash chain helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash for a transaction row.
 *
 * Content: prevHash + type + amount (string) + userId + createdAt (ISO-8601)
 */
export function computeTxHash(
  prevHash: string,
  type: TransactionType,
  amount: Decimal | number | string,
  userId: string,
  createdAt: Date
): string {
  const content = `${prevHash}${type}${amount.toString()}${userId}${createdAt.toISOString()}`;
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// appendTransaction
// ---------------------------------------------------------------------------

export interface AppendTransactionData {
  userId: string;
  debitAccount: string;
  creditAccount: string;
  type: TransactionType;
  /** Dollar amount (stored as Decimal). Use integer-cent values, e.g. 50.00 for $50. */
  amount: Decimal | number | string;
  stripeSessionId?: string;
  /** If provided, use this as prevHash (caller owns the transaction). Otherwise
   *  we query the DB for the latest txHash. The caller MUST pass a Prisma
   *  transaction client to keep the read-then-write atomic. */
  prevHash?: string;
}

/**
 * Append a new transaction to the ledger.
 *
 * - Fetches the previous transaction's txHash (or genesis hash if none exists).
 * - Computes SHA-256 txHash = hash(prevHash + type + amount + userId + createdAt).
 * - INSERTs the row (append-only; trigger prevents UPDATE/DELETE).
 *
 * MUST be called inside a Prisma interactive transaction when the caller needs
 * atomicity with other writes (e.g. the purchase engine).
 *
 * @param data  - Transaction fields.
 * @param tx    - Optional Prisma transaction client for atomicity.
 * @returns The newly created Transaction row.
 */
export async function appendTransaction(
  data: AppendTransactionData,
  tx?: Prisma.TransactionClient
): Promise<Transaction> {
  const client = tx ?? prisma;
  const amountDecimal = new Decimal(data.amount.toString());

  // Fetch previous hash inside the same DB transaction (serializes chain writes).
  const prevHash =
    data.prevHash ??
    (await (async () => {
      const lastTx = await client.transaction.findFirst({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { txHash: true },
      });
      return lastTx?.txHash ?? GENESIS_HASH;
    })());

  const createdAt = new Date();
  const txHash = computeTxHash(
    prevHash,
    data.type,
    amountDecimal,
    data.userId,
    createdAt
  );

  return client.transaction.create({
    data: {
      userId: data.userId,
      debitAccount: data.debitAccount,
      creditAccount: data.creditAccount,
      type: data.type,
      amount: amountDecimal,
      prevHash,
      txHash,
      stripeSessionId: data.stripeSessionId,
      createdAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Balance queries
// ---------------------------------------------------------------------------

/**
 * Derive a user's current balance from the transactions ledger.
 *
 * balance = SUM(amount WHERE creditAccount = 'user:{userId}')
 *         - SUM(amount WHERE debitAccount  = 'user:{userId}')
 *
 * Uses raw SQL for performance (avoids loading every row into JS).
 */
export async function getUserBalance(
  userId: string,
  tx?: Prisma.TransactionClient
): Promise<Decimal> {
  const client = tx ?? prisma;
  const account = `user:${userId}`;

  const result = await client.$queryRaw<[{ balance: string | null }]>`
    SELECT
      COALESCE(
        SUM(CASE WHEN credit_account = ${account} THEN amount ELSE 0 END) -
        SUM(CASE WHEN debit_account  = ${account} THEN amount ELSE 0 END),
        0
      ) AS balance
    FROM transactions
  `;

  return new Decimal(result[0]?.balance ?? "0");
}

/**
 * Sum of all charity fees collected across all market resolutions.
 */
export async function getCharityPoolTotal(
  tx?: Prisma.TransactionClient
): Promise<Decimal> {
  const client = tx ?? prisma;

  const result = await client.$queryRaw<[{ total: string | null }]>`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM transactions
    WHERE type = 'CHARITY_FEE'
  `;

  return new Decimal(result[0]?.total ?? "0");
}

/**
 * Sum of all confirmed deposits (Stripe-verified payments).
 */
export async function getTotalDeposits(
  tx?: Prisma.TransactionClient
): Promise<Decimal> {
  const client = tx ?? prisma;

  const result = await client.$queryRaw<[{ total: string | null }]>`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM transactions
    WHERE type = 'DEPOSIT'
  `;

  return new Decimal(result[0]?.total ?? "0");
}

/**
 * Sum of all withdrawal amounts processed (i.e. approved + paid out).
 * Includes all WITHDRAWAL-type transactions — caller filters by status
 * via WithdrawalRequest table if needed.
 */
export async function getTotalWithdrawals(
  tx?: Prisma.TransactionClient
): Promise<Decimal> {
  const client = tx ?? prisma;

  const result = await client.$queryRaw<[{ total: string | null }]>`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM transactions
    WHERE type = 'WITHDRAWAL'
  `;

  return new Decimal(result[0]?.total ?? "0");
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  /** True when the system is solvent (housePool >= 0). */
  isBalanced: boolean;
  totalDeposits: Decimal;
  totalUserBalances: Decimal;
  charityPool: Decimal;
  withdrawalsPaid: Decimal;
  /**
   * Residual house pool = deposits − userBalances − charity − withdrawals.
   * Represents LMSR profit from losing bets.
   * Negative value = insolvency (system owes more than it received).
   */
  housePool: Decimal;
  checkedAt: Date;
}

/**
 * Verify the reconciliation invariant:
 *
 *   SUM(user_balances) + SUM(charity_fees) + SUM(withdrawals) + house_pool = SUM(deposits)
 *   where house_pool >= 0
 *
 * Runs inside a READ-COMMITTED snapshot to get a consistent view.
 * Returns a structured result; does NOT throw on imbalance — callers
 * inside transactions should ROLLBACK if isBalanced is false.
 */
export async function runReconciliation(
  tx?: Prisma.TransactionClient
): Promise<ReconciliationResult> {
  const client = tx ?? prisma;

  // Total aggregate user balances in one pass (avoids per-user fan-out).
  const userBalResult = await client.$queryRaw<
    [{ total_user_balances: string | null }]
  >`
    SELECT
      COALESCE(
        SUM(CASE WHEN credit_account LIKE 'user:%' THEN  amount ELSE 0 END) -
        SUM(CASE WHEN debit_account  LIKE 'user:%' THEN  amount ELSE 0 END),
        0
      ) AS total_user_balances
    FROM transactions
  `;

  const [deposits, charity, withdrawals] = await Promise.all([
    getTotalDeposits(client),
    getCharityPoolTotal(client),
    getTotalWithdrawals(client),
  ]);

  const totalUserBalances = new Decimal(
    userBalResult[0]?.total_user_balances ?? "0"
  );

  // house_pool = deposits - userBalances - charity - withdrawals
  const housePool = deposits
    .minus(totalUserBalances)
    .minus(charity)
    .minus(withdrawals);

  return {
    isBalanced: housePool.greaterThanOrEqualTo(0),
    totalDeposits: deposits,
    totalUserBalances,
    charityPool: charity,
    withdrawalsPaid: withdrawals,
    housePool,
    checkedAt: new Date(),
  };
}
