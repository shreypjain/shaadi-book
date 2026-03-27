/**
 * Balance derivation helpers — PRD §6.2 + §7.4
 *
 * User balances are NEVER stored independently.  They are always derived from
 * the append-only `transactions` ledger (double-entry: credits - debits).
 *
 * All public functions return integer cents to match the application-layer
 * convention (CLAUDE.md: "All prices in cents (integer math)").
 */

import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Minimal queryable client — satisfied by both the main PrismaClient and the
 * interactive-transaction sub-client returned inside prisma.$transaction().
 */
type QueryClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

/** Coerce any Prisma/postgres numeric return value to a JS number. */
function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string") return parseFloat(val) || 0;
  // Decimal objects from decimal.js / @prisma/client
  if (typeof val === "object" && "toNumber" in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return parseFloat(String(val)) || 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a user's current balance from the transactions ledger.
 *
 * balance = SUM(amount WHERE credit_account = 'user:{id}')
 *         - SUM(amount WHERE debit_account  = 'user:{id}')
 *
 * Positive balance entries: DEPOSIT, PAYOUT (money flowing into user account)
 * Negative balance entries: PURCHASE, WITHDRAWAL (money leaving user account)
 *
 * @param userId - UUID of the user
 * @param client - Prisma client or tx sub-client (injectable for tests)
 * @returns Balance in integer cents (e.g. 5000 = $50.00)
 */
export async function getUserBalance(
  userId: string,
  client: QueryClient = prisma as QueryClient
): Promise<number> {
  const userAccount = `user:${userId}`;

  const result = await client.$queryRaw<Array<{ balance: unknown }>>`
    SELECT
      COALESCE(
        SUM(CASE WHEN credit_account = ${userAccount} THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  = ${userAccount} THEN amount ELSE 0 END),
        0
      ) AS balance
    FROM transactions
  `;

  const balanceDollars = toNumber(result[0]?.balance ?? 0);
  // Round to nearest cent to avoid floating-point drift across many transactions.
  return Math.round(balanceDollars * 100);
}

/**
 * Sum of all costs a user has spent on a specific market.
 *
 * Used to enforce the $50-per-user-per-market cap (PRD §9, rule 2).
 *
 * @param userId   - UUID of the user
 * @param marketId - UUID of the market
 * @param client   - Prisma client or tx sub-client (injectable for tests)
 * @returns Total spent in integer cents (e.g. 2000 = $20.00)
 */
export async function getUserMarketSpend(
  userId: string,
  marketId: string,
  client: QueryClient = prisma as QueryClient
): Promise<number> {
  const result = await client.$queryRaw<Array<{ total_spend: unknown }>>`
    SELECT COALESCE(SUM(cost), 0) AS total_spend
    FROM purchases
    WHERE user_id = ${userId}::uuid
      AND market_id = ${marketId}::uuid
  `;

  const spendDollars = toNumber(result[0]?.total_spend ?? 0);
  return Math.round(spendDollars * 100);
}
