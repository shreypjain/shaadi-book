/**
 * Balance helpers — derived from the append-only transactions ledger.
 *
 * User balances are NEVER stored directly; they are always computed from the
 * ledger (PRD §6.2, CLAUDE.md).
 *
 * Convention (double-entry):
 *   DEPOSIT  → credit_account = "user:{id}" → balance ↑
 *   PURCHASE → debit_account  = "user:{id}" → balance ↓
 *   PAYOUT   → credit_account = "user:{id}" → balance ↑
 *
 * Balance = Σ(amount WHERE credit_account="user:{id}")
 *         − Σ(amount WHERE debit_account="user:{id}")
 */

import type { PrismaLike } from "./hashChain.js";

// ---------------------------------------------------------------------------
// getUserBalance
// ---------------------------------------------------------------------------

/**
 * Derive a user's current balance in **dollars** from the transaction ledger.
 *
 * Call inside the same database transaction as any balance-modifying operation
 * to prevent TOCTOU races.
 *
 * @param userId - UUID of the user.
 * @param db     - Prisma client or transaction sub-client.
 * @returns Balance in dollars (may be 0.0 but never legitimately negative).
 */
export async function getUserBalance(
  userId: string,
  db: PrismaLike
): Promise<number> {
  const userAccount = `user:${userId}`;

  const [credits, debits] = await Promise.all([
    db.transaction.aggregate({
      where: { creditAccount: userAccount },
      _sum: { amount: true },
    }),
    db.transaction.aggregate({
      where: { debitAccount: userAccount },
      _sum: { amount: true },
    }),
  ]);

  const creditSum = credits._sum.amount?.toNumber() ?? 0;
  const debitSum = debits._sum.amount?.toNumber() ?? 0;
  return creditSum - debitSum;
}

// ---------------------------------------------------------------------------
// getUserMarketSpend
// ---------------------------------------------------------------------------

/**
 * Return the total dollars a user has spent on a specific market.
 *
 * Used to enforce the $50 per-market cap (PRD §9 rule 2).
 *
 * @param userId   - UUID of the user.
 * @param marketId - UUID of the market.
 * @param db       - Prisma client or transaction sub-client.
 * @returns Total spend in dollars.
 */
export async function getUserMarketSpend(
  userId: string,
  marketId: string,
  db: PrismaLike
): Promise<number> {
  const result = await db.purchase.aggregate({
    where: { userId, marketId },
    _sum: { cost: true },
  });
  return result._sum.cost?.toNumber() ?? 0;
}
