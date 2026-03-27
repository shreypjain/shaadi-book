/**
 * Immutable Ledger Service — PRD §7.4
 *
 * Central service for all ledger operations:
 *   appendTransaction   — insert a transaction with SHA-256 hash chain
 *   getUserBalance      — derive user balance (credits - debits)
 *   getCharityPoolTotal — net credit balance of the charity_pool account
 *   getTotalDeposits    — total DEPOSIT transaction amounts
 *   runReconciliation   — verify the conservation invariant
 *
 * Every balance is derived from the append-only `transactions` table —
 * never stored independently.
 *
 * Hash chain: txHash = SHA256(prevHash | type | amount | userId | createdAt)
 * The background verifier (hashChainVerifier.ts) checks this every 60 s.
 */

import { Decimal } from "decimal.js";

import { prisma } from "../db.js";
import { computeHash } from "./hashChain.js";

// ---------------------------------------------------------------------------
// Enum mirror — Prisma client may not be generated in all environments
// ---------------------------------------------------------------------------

/** Mirrors the TransactionType enum in schema.prisma. */
export type LedgerTransactionType =
  | "DEPOSIT"
  | "PURCHASE"
  | "PAYOUT"
  | "CHARITY_FEE"
  | "WITHDRAWAL"
  | "REFUND";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Minimal queryable interface — satisfied by main PrismaClient and tx sub-clients. */
type QueryClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

/** Coerce any Prisma / postgres numeric return value to a plain JS number. */
function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object" && "toNumber" in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return parseFloat(String(val)) || 0;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Input fields for a new transaction — hash chain fields are computed internally. */
export interface AppendTransactionInput {
  userId: string;
  /** Ledger account being debited, e.g. "user:{uuid}" or "house_amm". */
  debitAccount: string;
  /** Ledger account being credited. */
  creditAccount: string;
  type: LedgerTransactionType;
  /** Amount in US dollars (not cents). Stored as Decimal(18,6). */
  amount: number;
  /** Stripe checkout session ID — only set for DEPOSIT transactions. */
  stripeSessionId?: string;
  /** Explicit timestamp — defaults to now(). Useful for deterministic testing. */
  createdAt?: Date;
}

/** Return value of runReconciliation — all dollar amounts. */
export interface ReconciliationResult {
  valid: boolean;
  userBalances: number;
  houseAmm: number;
  charityPool: number;
  totalDeposits: number;
  totalWithdrawals: number;
  /** lhs = userBalances + houseAmm + charityPool + totalWithdrawals */
  lhs: number;
  /** rhs = totalDeposits */
  rhs: number;
  /** |lhs - rhs| — should be < 0.0001 for a healthy ledger */
  diff: number;
}

// ---------------------------------------------------------------------------
// appendTransaction
// ---------------------------------------------------------------------------

/**
 * Append a new transaction to the immutable ledger.
 *
 * Wraps in a Serializable transaction so that `getLastHash` and the INSERT
 * are atomic — preventing hash chain races under concurrent writes.
 *
 * NOTE: The purchase engine computes the hash chain inline inside its own
 * transaction (see purchaseEngine.ts). Use appendTransaction for standalone,
 * single-row inserts (e.g. Stripe deposit credits, withdrawal records).
 *
 * @returns { id, txHash } of the newly inserted row
 */
export async function appendTransaction(
  data: AppendTransactionInput
): Promise<{ id: string; txHash: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.$transaction as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      // Get the last hash INSIDE the transaction to prevent concurrent races.
      const lastTx = (await tx.transaction.findFirst({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { txHash: true },
      })) as { txHash: string } | null;

      const prevHash = lastTx?.txHash ?? "0".repeat(64);
      const now = data.createdAt ?? new Date();

      const txHash = computeHash(
        prevHash,
        data.type,
        new Decimal(data.amount).toFixed(6),
        data.userId,
        now.toISOString()
      );

      const record = (await tx.transaction.create({
        data: {
          userId: data.userId,
          debitAccount: data.debitAccount,
          creditAccount: data.creditAccount,
          type: data.type,
          amount: new Decimal(data.amount),
          prevHash,
          txHash,
          stripeSessionId: data.stripeSessionId ?? null,
          createdAt: now,
        },
        select: { id: true },
      })) as { id: string };

      return { id: record.id, txHash };
    },
    { isolationLevel: "Serializable", timeout: 10_000 }
  );
}

// ---------------------------------------------------------------------------
// getUserBalance
// ---------------------------------------------------------------------------

/**
 * Derive a user's current balance from the transactions ledger.
 *
 * balance = SUM(amount WHERE credit_account = 'user:{id}')
 *         - SUM(amount WHERE debit_account  = 'user:{id}')
 *
 * @param userId - UUID of the user
 * @param client - Prisma client or tx sub-client (injectable for unit tests)
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

  return Math.round(toNumber(result[0]?.balance ?? 0) * 100);
}

// ---------------------------------------------------------------------------
// getCharityPoolTotal
// ---------------------------------------------------------------------------

/**
 * Return the net balance accumulated in the charity_pool ledger account.
 *
 * @returns Charity pool total in integer cents
 */
export async function getCharityPoolTotal(
  client: QueryClient = prisma as QueryClient
): Promise<number> {
  const result = await client.$queryRaw<Array<{ total: unknown }>>`
    SELECT
      COALESCE(
        SUM(CASE WHEN credit_account = 'charity_pool' THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  = 'charity_pool' THEN amount ELSE 0 END),
        0
      ) AS total
    FROM transactions
  `;

  return Math.round(toNumber(result[0]?.total ?? 0) * 100);
}

// ---------------------------------------------------------------------------
// getTotalDeposits
// ---------------------------------------------------------------------------

/**
 * Sum all DEPOSIT transaction amounts.
 *
 * @returns Total deposits in integer cents
 */
export async function getTotalDeposits(
  client: QueryClient = prisma as QueryClient
): Promise<number> {
  const result = await client.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM transactions
    WHERE type = 'DEPOSIT'
  `;

  return Math.round(toNumber(result[0]?.total ?? 0) * 100);
}

// ---------------------------------------------------------------------------
// runReconciliation
// ---------------------------------------------------------------------------

/**
 * Check the conservation invariant (PRD §7.4):
 *
 *   SUM(user balances) + SUM(house_amm) + SUM(charity_pool) + SUM(withdrawals)
 *     = SUM(deposits)
 *
 * Returns a ReconciliationResult object with `valid: boolean`. Does NOT throw —
 * use this for admin display. The purchase engine has its own throwing version
 * that triggers a ROLLBACK on violation.
 *
 * @param client - Prisma client or tx sub-client (injectable for tests)
 */
export async function runReconciliation(
  client: QueryClient = prisma as QueryClient
): Promise<ReconciliationResult> {
  const result = await client.$queryRaw<
    Array<{
      user_balances: unknown;
      house_amm: unknown;
      charity_pool: unknown;
      total_deposits: unknown;
      total_withdrawals: unknown;
    }>
  >`
    SELECT
      COALESCE(
        SUM(CASE WHEN credit_account LIKE 'user:%' THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  LIKE 'user:%' THEN amount ELSE 0 END),
        0
      ) AS user_balances,
      COALESCE(
        SUM(CASE WHEN credit_account = 'house_amm' THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  = 'house_amm' THEN amount ELSE 0 END),
        0
      ) AS house_amm,
      COALESCE(
        SUM(CASE WHEN credit_account = 'charity_pool' THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  = 'charity_pool' THEN amount ELSE 0 END),
        0
      ) AS charity_pool,
      COALESCE(SUM(CASE WHEN type = 'DEPOSIT'    THEN amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) AS total_withdrawals
    FROM transactions
  `;

  const row = result[0];

  if (!row) {
    return {
      valid: true,
      userBalances: 0,
      houseAmm: 0,
      charityPool: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      lhs: 0,
      rhs: 0,
      diff: 0,
    };
  }

  const userBalances = toNumber(row.user_balances);
  const houseAmm = toNumber(row.house_amm);
  const charityPool = toNumber(row.charity_pool);
  const totalDeposits = toNumber(row.total_deposits);
  const totalWithdrawals = toNumber(row.total_withdrawals);

  const lhs = userBalances + houseAmm + charityPool + totalWithdrawals;
  const rhs = totalDeposits;
  const diff = Math.abs(lhs - rhs);

  return {
    valid: diff <= 0.0001,
    userBalances,
    houseAmm,
    charityPool,
    totalDeposits,
    totalWithdrawals,
    lhs,
    rhs,
    diff,
  };
}
