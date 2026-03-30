/**
 * Purchase Engine — PRD §6.3
 *
 * Implements buyShares() as a single atomic Postgres transaction:
 *   validate → lock → compute b → compute shares → update state →
 *   insert purchase → insert transaction → upsert position →
 *   reconciliation check → hash chain → commit → return result
 *
 * Isolation: Serializable — prevents phantom reads / write-skew on concurrent
 * purchases.  The `SELECT ... FOR UPDATE` on outcomes provides explicit
 * row-level locking so only one writer processes a given market at a time.
 *
 * Error handling: every error causes an immediate ROLLBACK (Prisma $transaction
 * semantics).  Never swallowed.
 */

import { Decimal } from "decimal.js";

import { prisma } from "../db.js";
import {
  defaultB,
  allPrices,
  computeSharesForDollarAmount,
  computeDollarAmountForShares,
  price,
} from "./lmsr.js";
import { computeHash } from "./hashChain.js";
import { recordPurchaseSnapshots } from "./priceSnapshot.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 10% fee on sell revenue. Stays in house_amm (no separate transaction). */
export const SELL_FEE_RATE = 0.10;

/** 30-minute cooldown: users cannot sell shares within 30 min of buying them. */
export const SELL_COOLDOWN_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce any Postgres/Prisma numeric return to a plain JS number. */
export function toNumber(val: unknown): number {
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

/** Structured error thrown by buyShares() / sellShares() — carries a machine-readable code. */
export class PurchaseError extends Error {
  constructor(
    public readonly code:
      | "INVALID_AMOUNT"
      | "MARKET_NOT_FOUND"
      | "MARKET_NOT_ACTIVE"
      | "MARKET_NOT_OPEN"
      | "NO_OUTCOMES"
      | "OUTCOME_NOT_FOUND"
      | "INSUFFICIENT_BALANCE"
      | "CAP_EXCEEDED"
      | "RECONCILIATION_FAILED"
      | "NO_POSITION"
      | "INSUFFICIENT_SHARES"
      | "SELL_COOLDOWN",
    message: string
  ) {
    super(message);
    this.name = "PurchaseError";
  }
}

/** Shape returned by a successful sellShares() call. */
export interface SellResult {
  /** UUID of the newly created Transaction row (type=SALE). */
  transactionId: string;
  /** Number of shares sold. */
  shares: number;
  /** Net revenue received after sell fee — integer cents. */
  revenueCents: number;
  /** Gross revenue before fee — integer cents. */
  grossRevenueCents: number;
  /** Fee deducted — integer cents. */
  feeCents: number;
  /** Spot price of the sold outcome immediately BEFORE the trade — cents. */
  priceBeforeCents: number;
  /** Spot price of the sold outcome immediately AFTER the trade — cents. */
  priceAfterCents: number;
  /** Updated prices for ALL outcomes, ordered by position, in [0,1] fractions. */
  allNewPrices: number[];
  /** All outcome UUIDs ordered by position (parallel to allNewPrices). */
  outcomeIds: string[];
  /** Outcome label of the sold outcome (for WebSocket broadcast). */
  outcomeLabel: string;
}

/** Shape returned by a successful buyShares() call. */
export interface PurchaseResult {
  /** UUID of the newly created Purchase row. */
  purchaseId: string;
  /** UUID of the newly created Transaction row. */
  transactionId: string;
  /** Shares received (4 decimal places). */
  shares: number;
  /** Cost paid — integer cents (mirrors dollarAmountCents input). */
  costCents: number;
  /** Spot price of the purchased outcome immediately BEFORE the trade — cents. */
  priceBeforeCents: number;
  /** Spot price of the purchased outcome immediately AFTER the trade — cents. */
  priceAfterCents: number;
  /** Updated prices for ALL outcomes, ordered by position, in [0,1] fractions. */
  allNewPrices: number[];
  /** All outcome UUIDs ordered by position (parallel to allNewPrices). */
  outcomeIds: string[];
  /** Outcome label of the purchased outcome (for WebSocket broadcast). */
  outcomeLabel: string;
}

// ---------------------------------------------------------------------------
// Internal — row shape from $queryRaw FOR UPDATE lock
// ---------------------------------------------------------------------------

interface LockedOutcomeRow {
  id: string;
  market_id: string;
  position: number | bigint;
  shares_sold: unknown;
  label: string;
}

// ---------------------------------------------------------------------------
// Internal — reconciliation
// ---------------------------------------------------------------------------

/**
 * Conservation invariant (PRD §7.4):
 *
 *   SUM(user balances) + SUM(house_amm) + SUM(withdrawals) = SUM(deposits)
 *
 * Where each term is derived from the credit/debit accounts in the ledger.
 * This is the double-entry conservation law; any violation indicates a bug or
 * tampered row.
 *
 * Note: charity fees are collected externally (10% via Venmo post-wedding)
 * and are NOT tracked as ledger transactions.
 *
 * Throws PurchaseError('RECONCILIATION_FAILED', ...) on mismatch > 0.0001 USD.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runReconciliation(tx: any): Promise<void> {
  const result = (await tx.$queryRaw`
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
      COALESCE(SUM(CASE WHEN type = 'DEPOSIT'    THEN amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) AS total_withdrawals
    FROM transactions
  `) as Array<{
    user_balances: unknown;
    house_amm: unknown;
    total_deposits: unknown;
    total_withdrawals: unknown;
  }>;

  const row = result[0];
  if (!row) {
    // Empty ledger — no transactions yet.  Trivially balanced.
    return;
  }

  const userBalances = toNumber(row.user_balances);
  const houseAmm = toNumber(row.house_amm);
  const totalDeposits = toNumber(row.total_deposits);
  const totalWithdrawals = toNumber(row.total_withdrawals);

  // Conservation: money attributed to all accounts equals money deposited minus money withdrawn.
  // lhs = user balances + AMM pool + withdrawals-paid
  // rhs = total deposits received
  const lhs = userBalances + houseAmm + totalWithdrawals;
  const rhs = totalDeposits;
  const diff = Math.abs(lhs - rhs);

  if (diff > 0.0001) {
    throw new PurchaseError(
      "RECONCILIATION_FAILED",
      `Reconciliation failed: lhs=${lhs.toFixed(6)} rhs=${rhs.toFixed(6)} diff=${diff.toFixed(6)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public — buyShares()
// ---------------------------------------------------------------------------

/**
 * Execute a share purchase as a single atomic Postgres transaction.
 *
 * Steps (matching PRD §6.3 pseudocode exactly):
 *  1. Input validation
 *  2. BEGIN TRANSACTION (Serializable isolation)
 *  3. Validate market is ACTIVE
 *  4. SELECT outcomes FOR UPDATE (row-level lock)
 *  5. Check user balance >= dollarAmount
 *  6. Check user market spend + dollarAmount <= $200
 *  7. Compute adaptive b (dtMs, totalVolume)
 *  8. Read state vector q[]
 *  9. Compute delta shares via binary search
 * 10. UPDATE outcomes[i].sharesSold += delta
 * 11. Compute new prices for all outcomes
 * 12. INSERT Purchase row
 * 13. Get prevHash, compute txHash, INSERT Transaction row
 * 14. UPSERT Position
 * 15. Run reconciliation invariant check
 * 16. COMMIT → return PurchaseResult
 *
 * @param userId            - UUID of the purchasing user
 * @param marketId          - UUID of the target market
 * @param outcomeId         - UUID of the outcome being purchased
 * @param dollarAmountCents - Integer amount in cents (e.g. 1000 = $10.00)
 * @returns PurchaseResult on success; throws PurchaseError on validation failure
 */
export async function buyShares(
  userId: string,
  marketId: string,
  outcomeId: string,
  dollarAmountCents: number
): Promise<PurchaseResult> {
  // -------------------------------------------------------------------------
  // 1. Pre-flight input validation (before any DB round-trip)
  // -------------------------------------------------------------------------
  if (!Number.isInteger(dollarAmountCents) || dollarAmountCents <= 0) {
    throw new PurchaseError(
      "INVALID_AMOUNT",
      `dollarAmountCents must be a positive integer; got ${dollarAmountCents}`
    );
  }

  const dollarAmount = dollarAmountCents / 100; // $

  // -------------------------------------------------------------------------
  // 2. Atomic transaction — Serializable isolation to prevent write-skew
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: PurchaseResult = await (prisma.$transaction as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<PurchaseResult> => {
      // -----------------------------------------------------------------------
      // 3. Fetch market — validate status ACTIVE and openedAt is set
      // -----------------------------------------------------------------------
      const market = (await tx.market.findUnique({
        where: { id: marketId },
        select: {
          id: true,
          status: true,
          openedAt: true,
          bFloorOverride: true,
        },
      })) as {
        id: string;
        status: string;
        openedAt: Date | null;
        bFloorOverride: unknown | null;
      } | null;

      if (!market) {
        throw new PurchaseError(
          "MARKET_NOT_FOUND",
          `Market ${marketId} not found`
        );
      }
      if (market.status !== "ACTIVE") {
        throw new PurchaseError(
          "MARKET_NOT_ACTIVE",
          `Market is ${market.status}, expected ACTIVE`
        );
      }
      if (!market.openedAt) {
        throw new PurchaseError(
          "MARKET_NOT_OPEN",
          "Market is ACTIVE but has no openedAt timestamp"
        );
      }

      // -----------------------------------------------------------------------
      // 4. Lock all outcome rows for this market (SELECT ... FOR UPDATE)
      //    Orders by position so state vector q[] is always deterministic.
      // -----------------------------------------------------------------------
      const lockedOutcomes = (await tx.$queryRaw`
        SELECT id, market_id, position, shares_sold, label
        FROM outcomes
        WHERE market_id = ${marketId}
        ORDER BY position
        FOR UPDATE
      `) as LockedOutcomeRow[];

      if (lockedOutcomes.length === 0) {
        throw new PurchaseError(
          "NO_OUTCOMES",
          `Market ${marketId} has no outcome rows`
        );
      }

      const outcomeIndex = lockedOutcomes.findIndex(
        (o: LockedOutcomeRow) => o.id === outcomeId
      );
      if (outcomeIndex === -1) {
        throw new PurchaseError(
          "OUTCOME_NOT_FOUND",
          `Outcome ${outcomeId} not found in market ${marketId}`
        );
      }

      const targetOutcome = lockedOutcomes[outcomeIndex] as LockedOutcomeRow;

      // -----------------------------------------------------------------------
      // 5. Check user balance >= dollarAmount
      // -----------------------------------------------------------------------
      const userAccount = `user:${userId}`;
      const balanceResult = (await tx.$queryRaw`
        SELECT
          COALESCE(
            SUM(CASE WHEN credit_account = ${userAccount} THEN amount ELSE 0 END)
            - SUM(CASE WHEN debit_account  = ${userAccount} THEN amount ELSE 0 END),
            0
          ) AS balance
        FROM transactions
      `) as Array<{ balance: unknown }>;

      const balanceDollars = toNumber(balanceResult[0]?.balance ?? 0);

      if (balanceDollars < dollarAmount) {
        throw new PurchaseError(
          "INSUFFICIENT_BALANCE",
          `Insufficient balance: have $${balanceDollars.toFixed(2)}, need $${dollarAmount.toFixed(2)}`
        );
      }

      // -----------------------------------------------------------------------
      // 6. Check $200 per-user per-market cap
      // -----------------------------------------------------------------------
      const spendResult = (await tx.$queryRaw`
        SELECT COALESCE(SUM(cost), 0) AS total_spend
        FROM purchases
        WHERE user_id  = ${userId}
          AND market_id = ${marketId}
      `) as Array<{ total_spend: unknown }>;

      const existingSpendDollars = toNumber(spendResult[0]?.total_spend ?? 0);

      if (existingSpendDollars + dollarAmount > 200) {
        const remaining = Math.max(0, 200 - existingSpendDollars);
        throw new PurchaseError(
          "CAP_EXCEEDED",
          `Purchase would exceed $200 market cap. Already spent: $${existingSpendDollars.toFixed(2)}, remaining: $${remaining.toFixed(2)}, attempted: $${dollarAmount.toFixed(2)}`
        );
      }

      // -----------------------------------------------------------------------
      // 7. Compute b — fixed per market shape, admin-overridable via bFloorOverride
      //    With fixed 100-share supply, b is constant for the lifetime of the market.
      //    defaultB(n) targets p≈0.95 when the leading outcome holds 80% of shares.
      // -----------------------------------------------------------------------
      const bOverride =
        market.bFloorOverride !== null && market.bFloorOverride !== undefined
          ? toNumber(market.bFloorOverride)
          : 0;
      const b = bOverride > 0 ? bOverride : defaultB(lockedOutcomes.length);

      // -----------------------------------------------------------------------
      // 8. Read state vector q[] from locked outcome rows
      // -----------------------------------------------------------------------
      const q: number[] = lockedOutcomes.map((o: LockedOutcomeRow) =>
        toNumber(o.shares_sold)
      );

      // -----------------------------------------------------------------------
      // 9. Compute delta shares via binary search (PRD §6.3 step 7)
      //    C(q1,..,qi+Δ,..,qn) - C(q) = dollarAmount
      // -----------------------------------------------------------------------
      const priceBeforeFraction = price(q, b, outcomeIndex);
      const deltaShares = computeSharesForDollarAmount(
        q,
        b,
        outcomeIndex,
        dollarAmount
      );

      // -----------------------------------------------------------------------
      // 10. UPDATE outcomes[i].sharesSold += delta
      // -----------------------------------------------------------------------
      await tx.outcome.update({
        where: { id: outcomeId },
        data: {
          sharesSold: { increment: new Decimal(deltaShares) },
        },
      });

      // -----------------------------------------------------------------------
      // 11. Compute new prices for all outcomes post-purchase
      // -----------------------------------------------------------------------
      const qNew = q.slice();
      qNew[outcomeIndex] = (q[outcomeIndex] ?? 0) + deltaShares;
      const newPrices = allPrices(qNew, b);
      const priceAfterFraction = newPrices[outcomeIndex] as number;
      const avgPrice =
        deltaShares > 0 ? dollarAmount / deltaShares : priceBeforeFraction;

      // -----------------------------------------------------------------------
      // 12. INSERT Purchase (immutable — triggers prevent UPDATE/DELETE)
      // -----------------------------------------------------------------------
      const purchaseRecord = (await tx.purchase.create({
        data: {
          userId,
          marketId,
          outcomeId,
          shares: new Decimal(deltaShares),
          cost: new Decimal(dollarAmount),
          avgPrice: new Decimal(avgPrice),
          priceBefore: new Decimal(priceBeforeFraction),
          priceAfter: new Decimal(priceAfterFraction),
          bAtPurchase: new Decimal(b),
        },
      })) as { id: string };

      // -----------------------------------------------------------------------
      // 13. Hash chain: get prevHash, compute txHash, INSERT Transaction
      // -----------------------------------------------------------------------
      const lastTx = (await tx.transaction.findFirst({
        orderBy: { createdAt: "desc" },
        select: { txHash: true },
      })) as { txHash: string } | null;

      const prevHash = lastTx?.txHash ?? "0".repeat(64);
      const now = new Date();
      const txHash = computeHash(
        prevHash,
        "PURCHASE",
        dollarAmount.toFixed(6),
        userId,
        now.toISOString()
      );

      const txRecord = (await tx.transaction.create({
        data: {
          userId,
          debitAccount: `user:${userId}`,
          creditAccount: "house_amm",
          type: "PURCHASE",
          amount: new Decimal(dollarAmount),
          prevHash,
          txHash,
          createdAt: now,
        },
      })) as { id: string };

      // -----------------------------------------------------------------------
      // 14. UPSERT Position (create on first purchase, update thereafter)
      // -----------------------------------------------------------------------
      await tx.position.upsert({
        where: {
          userId_marketId_outcomeId: { userId, marketId, outcomeId },
        },
        update: {
          shares: { increment: new Decimal(deltaShares) },
          totalCost: { increment: new Decimal(dollarAmount) },
        },
        create: {
          userId,
          marketId,
          outcomeId,
          shares: new Decimal(deltaShares),
          totalCost: new Decimal(dollarAmount),
        },
      });

      // -----------------------------------------------------------------------
      // 15. Reconciliation invariant check — ROLLBACK on failure
      // -----------------------------------------------------------------------
      await runReconciliation(tx);

      // -----------------------------------------------------------------------
      // 16. Return result (Prisma commits on clean return)
      // -----------------------------------------------------------------------
      return {
        purchaseId: purchaseRecord.id,
        transactionId: txRecord.id,
        shares: deltaShares,
        costCents: dollarAmountCents,
        priceBeforeCents: Math.round(priceBeforeFraction * 100),
        priceAfterCents: Math.round(priceAfterFraction * 100),
        allNewPrices: newPrices,
        outcomeIds: lockedOutcomes.map((o: LockedOutcomeRow) => o.id),
        outcomeLabel: targetOutcome.label,
      };
    },
    {
      isolationLevel: "Serializable",
      timeout: 10_000, // 10 s — plenty for the purchase path
    }
  );

  // -------------------------------------------------------------------------
  // Fire-and-forget: record price snapshots for the chart (outside the
  // serializable transaction to keep it lean).
  // -------------------------------------------------------------------------
  recordPurchaseSnapshots(marketId, result.outcomeIds, result.allNewPrices).catch(
    (err: unknown) => {
      console.warn("[purchaseEngine] Failed to record price snapshots:", err);
    }
  );

  return result;
}

// ---------------------------------------------------------------------------
// Public — sellShares()
// ---------------------------------------------------------------------------

/**
 * Execute a share sale as a single atomic Postgres transaction.
 *
 * This is the mirror image of buyShares():
 *  - money flows FROM house_amm TO user (SALE transaction)
 *  - outcome sharesSold DECREMENTS
 *  - position shares and totalCost DECREMENT proportionally
 *  - a Purchase row with NEGATIVE shares/cost is inserted so that
 *    SUM(purchases.cost) over a market gives the true net pool
 *
 * Steps:
 *  1. Input validation
 *  2. BEGIN TRANSACTION (Serializable isolation)
 *  3. Validate market is ACTIVE
 *  4. SELECT outcomes FOR UPDATE (row-level lock)
 *  5. Fetch Position — validate user holds >= sharesToSell
 *  6. Compute b (same as buyShares)
 *  7. Read state vector q[]
 *  8. Get spot price BEFORE sale
 *  9. Compute revenue via computeDollarAmountForShares
 * 10. UPDATE outcomes[i].sharesSold -= sharesToSell
 * 11. Compute new prices for all outcomes
 * 12. Get prevHash, compute txHash, INSERT SALE Transaction
 * 13. UPDATE Position (decrement shares + proportional totalCost)
 * 14. INSERT Purchase row with negative shares/cost
 * 15. Run reconciliation invariant check
 * 16. COMMIT → return SellResult
 *
 * @param userId       - UUID of the selling user
 * @param marketId     - UUID of the target market
 * @param outcomeId    - UUID of the outcome being sold
 * @param sharesToSell - Number of shares to sell (must be > 0)
 * @returns SellResult on success; throws PurchaseError on validation failure
 */
export async function sellShares(
  userId: string,
  marketId: string,
  outcomeId: string,
  sharesToSell: number
): Promise<SellResult> {
  // -------------------------------------------------------------------------
  // 1. Pre-flight input validation (before any DB round-trip)
  // -------------------------------------------------------------------------
  if (sharesToSell <= 0 || !isFinite(sharesToSell)) {
    throw new PurchaseError(
      "INVALID_AMOUNT",
      `sharesToSell must be a positive finite number; got ${sharesToSell}`
    );
  }

  // -------------------------------------------------------------------------
  // 2. Atomic transaction — Serializable isolation to prevent write-skew
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: SellResult = await (prisma.$transaction as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<SellResult> => {
      // -----------------------------------------------------------------------
      // 3. Fetch market — validate status ACTIVE and openedAt is set
      // -----------------------------------------------------------------------
      const market = (await tx.market.findUnique({
        where: { id: marketId },
        select: {
          id: true,
          status: true,
          openedAt: true,
          bFloorOverride: true,
        },
      })) as {
        id: string;
        status: string;
        openedAt: Date | null;
        bFloorOverride: unknown | null;
      } | null;

      if (!market) {
        throw new PurchaseError(
          "MARKET_NOT_FOUND",
          `Market ${marketId} not found`
        );
      }
      if (market.status !== "ACTIVE") {
        throw new PurchaseError(
          "MARKET_NOT_ACTIVE",
          `Market is ${market.status}, expected ACTIVE`
        );
      }
      if (!market.openedAt) {
        throw new PurchaseError(
          "MARKET_NOT_OPEN",
          "Market is ACTIVE but has no openedAt timestamp"
        );
      }

      // -----------------------------------------------------------------------
      // 4. Lock all outcome rows for this market (SELECT ... FOR UPDATE)
      //    Orders by position so state vector q[] is always deterministic.
      // -----------------------------------------------------------------------
      const lockedOutcomes = (await tx.$queryRaw`
        SELECT id, market_id, position, shares_sold, label
        FROM outcomes
        WHERE market_id = ${marketId}
        ORDER BY position
        FOR UPDATE
      `) as LockedOutcomeRow[];

      if (lockedOutcomes.length === 0) {
        throw new PurchaseError(
          "NO_OUTCOMES",
          `Market ${marketId} has no outcome rows`
        );
      }

      const outcomeIndex = lockedOutcomes.findIndex(
        (o: LockedOutcomeRow) => o.id === outcomeId
      );
      if (outcomeIndex === -1) {
        throw new PurchaseError(
          "OUTCOME_NOT_FOUND",
          `Outcome ${outcomeId} not found in market ${marketId}`
        );
      }

      const targetOutcome = lockedOutcomes[outcomeIndex] as LockedOutcomeRow;

      // -----------------------------------------------------------------------
      // 5. Fetch user's Position — validate they hold enough shares to sell
      // -----------------------------------------------------------------------
      const position = (await tx.position.findUnique({
        where: {
          userId_marketId_outcomeId: { userId, marketId, outcomeId },
        },
        select: { shares: true, totalCost: true },
      })) as { shares: unknown; totalCost: unknown } | null;

      if (!position) {
        throw new PurchaseError(
          "NO_POSITION",
          `User ${userId} has no position in outcome ${outcomeId}`
        );
      }

      const positionShares = toNumber(position.shares);
      if (positionShares < sharesToSell) {
        throw new PurchaseError(
          "INSUFFICIENT_SHARES",
          `Cannot sell ${sharesToSell} shares — only ${positionShares.toFixed(4)} held`
        );
      }

      // -----------------------------------------------------------------------
      // 5b. Sell cooldown: cannot sell within 30 min of last buy
      // -----------------------------------------------------------------------
      const lastBuyResult = (await tx.$queryRaw`
        SELECT MAX(created_at) AS last_buy_at
        FROM purchases
        WHERE user_id = ${userId}
          AND outcome_id = ${outcomeId}
          AND shares > 0
      `) as Array<{ last_buy_at: Date | null }>;

      const lastBuyAt = lastBuyResult[0]?.last_buy_at;
      if (lastBuyAt) {
        const elapsed = Date.now() - new Date(lastBuyAt).getTime();
        if (elapsed < SELL_COOLDOWN_MS) {
          const remainingMin = Math.ceil((SELL_COOLDOWN_MS - elapsed) / 60_000);
          throw new PurchaseError(
            "SELL_COOLDOWN",
            `Cannot sell yet — ${remainingMin} minute${remainingMin === 1 ? "" : "s"} remaining. Shares must be held for 30 minutes after purchase.`
          );
        }
      }

      // -----------------------------------------------------------------------
      // 6. Compute b — fixed per market shape, admin-overridable via bFloorOverride
      // -----------------------------------------------------------------------
      const bOverride =
        market.bFloorOverride !== null && market.bFloorOverride !== undefined
          ? toNumber(market.bFloorOverride)
          : 0;
      const b = bOverride > 0 ? bOverride : defaultB(lockedOutcomes.length);

      // -----------------------------------------------------------------------
      // 7. Read state vector q[] from locked outcome rows
      // -----------------------------------------------------------------------
      const q: number[] = lockedOutcomes.map((o: LockedOutcomeRow) =>
        toNumber(o.shares_sold)
      );

      // -----------------------------------------------------------------------
      // 8. Get spot price BEFORE the sale
      // -----------------------------------------------------------------------
      const priceBeforeFraction = price(q, b, outcomeIndex);

      // -----------------------------------------------------------------------
      // 9. Compute revenue: C(q_before) − C(q_after), minus 10% sell fee
      //    Fee stays in house_amm (no separate transaction — we simply credit
      //    the user less than the gross LMSR revenue).
      // -----------------------------------------------------------------------
      const grossRevenueDollars = computeDollarAmountForShares(
        q,
        b,
        outcomeIndex,
        sharesToSell
      );
      const feeDollars = grossRevenueDollars * SELL_FEE_RATE;
      const revenueDollars = Math.round((grossRevenueDollars - feeDollars) * 10_000) / 10_000;
      const revenueCents = Math.round(revenueDollars * 100);

      // -----------------------------------------------------------------------
      // 10. UPDATE outcomes[i].sharesSold -= sharesToSell
      // -----------------------------------------------------------------------
      await tx.outcome.update({
        where: { id: outcomeId },
        data: {
          sharesSold: { decrement: new Decimal(sharesToSell) },
        },
      });

      // -----------------------------------------------------------------------
      // 11. Compute new prices for all outcomes post-sale
      // -----------------------------------------------------------------------
      const qNew = q.slice();
      qNew[outcomeIndex] = (q[outcomeIndex] ?? 0) - sharesToSell;
      const newPrices = allPrices(qNew, b);
      const priceAfterFraction = newPrices[outcomeIndex] as number;
      const avgPrice =
        sharesToSell > 0 ? revenueDollars / sharesToSell : priceBeforeFraction;

      // -----------------------------------------------------------------------
      // 12. Hash chain: get prevHash, compute txHash, INSERT SALE Transaction
      //     SALE reverses PURCHASE: debit house_amm, credit user:{userId}
      // -----------------------------------------------------------------------
      const lastTx = (await tx.transaction.findFirst({
        orderBy: { createdAt: "desc" },
        select: { txHash: true },
      })) as { txHash: string } | null;

      const prevHash = lastTx?.txHash ?? "0".repeat(64);
      const now = new Date();
      const txHash = computeHash(
        prevHash,
        "SALE",
        revenueDollars.toFixed(6),
        userId,
        now.toISOString()
      );

      const txRecord = (await tx.transaction.create({
        data: {
          userId,
          debitAccount: "house_amm",
          creditAccount: `user:${userId}`,
          type: "SALE",
          amount: new Decimal(revenueDollars),
          prevHash,
          txHash,
          createdAt: now,
        },
      })) as { id: string };

      // -----------------------------------------------------------------------
      // 13. UPDATE Position: decrement shares; decrement totalCost proportionally
      //     costToSubtract = totalCost × (sharesToSell / positionShares)
      // -----------------------------------------------------------------------
      const positionTotalCost = toNumber(position.totalCost);
      const costToSubtract =
        positionShares > 0
          ? new Decimal(positionTotalCost)
              .times(new Decimal(sharesToSell))
              .dividedBy(new Decimal(positionShares))
          : new Decimal(0);

      await tx.position.update({
        where: {
          userId_marketId_outcomeId: { userId, marketId, outcomeId },
        },
        data: {
          shares: { decrement: new Decimal(sharesToSell) },
          totalCost: { decrement: costToSubtract },
        },
      });

      // -----------------------------------------------------------------------
      // 14. INSERT Purchase row with NEGATIVE shares/cost to track the sale
      //     SUM(purchases.cost) for a market = net pool (buys minus sells).
      //     INSERT is safe even with immutability triggers — it is an append.
      // -----------------------------------------------------------------------
      await tx.purchase.create({
        data: {
          userId,
          marketId,
          outcomeId,
          shares: new Decimal(-sharesToSell),
          cost: new Decimal(-revenueDollars),
          avgPrice: new Decimal(avgPrice),
          priceBefore: new Decimal(priceBeforeFraction),
          priceAfter: new Decimal(priceAfterFraction),
          bAtPurchase: new Decimal(b),
        },
      });

      // -----------------------------------------------------------------------
      // 15. Reconciliation invariant check — ROLLBACK on failure
      // -----------------------------------------------------------------------
      await runReconciliation(tx);

      // -----------------------------------------------------------------------
      // 16. Return result (Prisma commits on clean return)
      // -----------------------------------------------------------------------
      return {
        transactionId: txRecord.id,
        shares: sharesToSell,
        revenueCents,
        grossRevenueCents: Math.round(grossRevenueDollars * 100),
        feeCents: Math.round(feeDollars * 100),
        priceBeforeCents: Math.round(priceBeforeFraction * 100),
        priceAfterCents: Math.round(priceAfterFraction * 100),
        allNewPrices: newPrices,
        outcomeIds: lockedOutcomes.map((o: LockedOutcomeRow) => o.id),
        outcomeLabel: targetOutcome.label,
      };
    },
    {
      isolationLevel: "Serializable",
      timeout: 10_000,
    }
  );

  // -------------------------------------------------------------------------
  // Fire-and-forget: record price snapshots for the chart (outside the
  // serializable transaction to keep it lean).
  // -------------------------------------------------------------------------
  recordPurchaseSnapshots(marketId, result.outcomeIds, result.allNewPrices).catch(
    (err: unknown) => {
      console.warn("[purchaseEngine] Failed to record price snapshots:", err);
    }
  );

  return result;
}
