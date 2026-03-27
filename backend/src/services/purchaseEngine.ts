/**
 * Purchase Engine — atomic LMSR share-buying transaction.
 *
 * Implements PRD §6.3 (purchase engine pseudocode) as a single interactive
 * Postgres transaction with row-level locking for concurrent-safety.
 *
 * All monetary values are stored in dollars (6 d.p.) in the DB; the public
 * API accepts cents (integers) and converts at the boundary.
 */

import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

// Structural interface that matches Prisma Decimal, decimal.js Decimal,
// or any object that exposes a toNumber() method.
interface DecimalLike {
  toNumber(): number;
}
import {
  adaptiveB,
  allPrices,
  computeSharesForDollarAmount,
} from "./lmsr.js";
import { getUserBalance, getUserMarketSpend } from "./balance.js";
import { computeHash, getLastHash } from "./hashChain.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MARKET_SPEND_DOLLARS = 50;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface BuySharesResult {
  purchaseId: string;
  shares: number;
  /** Amount spent in dollars (= dollarAmountCents / 100) */
  costDollars: number;
  bAtPurchase: number;
  priceBeforeDollars: number;
  priceAfterDollars: number;
  /** Updated prices for every outcome in the market */
  newPrices: Array<{ outcomeId: string; priceDollars: number }>;
  /** Caller's new balance in cents (integer) */
  newBalanceCents: number;
}

// ---------------------------------------------------------------------------
// Internal: raw outcome row returned by SELECT … FOR UPDATE
// ---------------------------------------------------------------------------

interface OutcomeRow {
  id: string;
  label: string;
  position: number;
  /** Postgres DECIMAL — comes back as DecimalLike, string, or number via queryRaw */
  shares_sold: DecimalLike | string | number;
}

// ---------------------------------------------------------------------------
// Internal helpers (≤ 50 lines each)
// ---------------------------------------------------------------------------

/** Normalise Postgres DECIMAL raw-query values to JavaScript number. */
function toNumber(v: DecimalLike | string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  return v.toNumber();
}

/**
 * Compute the adaptive-b parameter at purchase time.
 * Called inside the transaction for a consistent volume read.
 */
async function computeAdaptiveB(
  openedAt: Date | null,
  bFloorOverride: DecimalLike | null,
  marketId: string,
  tx: Prisma.TransactionClient
): Promise<number> {
  const nowMs = Date.now();
  const dtMs = Math.max(0, nowMs - (openedAt?.getTime() ?? nowMs));

  const volResult = await tx.purchase.aggregate({
    where: { marketId },
    _sum: { cost: true },
  });
  const totalVolumeDollars = toNumber(volResult._sum.cost);
  const bFloor = bFloorOverride != null ? toNumber(bFloorOverride) : 20;

  return adaptiveB(bFloor, dtMs, totalVolumeDollars);
}

/**
 * Append a PURCHASE transaction row with an updated hash-chain link.
 * Called inside the transaction immediately after the Purchase insert.
 */
async function appendTransactionRow(
  userId: string,
  dollarAmount: number,
  createdAt: Date,
  tx: Prisma.TransactionClient
): Promise<void> {
  const prevHash = await getLastHash(tx);
  const txHash = computeHash(
    prevHash,
    "PURCHASE",
    dollarAmount.toFixed(6),
    userId,
    createdAt
  );
  await tx.transaction.create({
    data: {
      userId,
      debitAccount: `user:${userId}`,
      creditAccount: "house_amm",
      type: "PURCHASE",
      amount: dollarAmount,
      prevHash,
      txHash,
      createdAt,
    },
  });
}

// ---------------------------------------------------------------------------
// buyShares — public API
// ---------------------------------------------------------------------------

/**
 * Execute an atomic LMSR share purchase.
 *
 * Steps (PRD §6.3):
 *  1.  Pre-flight: market ACTIVE, balance ≥ amount, cap ≤ $50
 *  2.  BEGIN interactive transaction
 *  3.  Lock user row + all outcome rows FOR UPDATE
 *  4.  Re-validate balance & cap under lock
 *  5.  Compute adaptive b
 *  6.  Binary-search for shares (LMSR)
 *  7.  UPDATE outcomes.sharesSold
 *  8.  INSERT Purchase
 *  9.  INSERT Transaction + hash chain
 * 10.  UPSERT Position
 * 11.  Reconciliation check (balance ≥ 0 post-insert)
 * 12.  COMMIT (implicit)
 *
 * @param userId            - UUID of the purchasing user.
 * @param marketId          - UUID of the market.
 * @param outcomeId         - UUID of the chosen outcome.
 * @param dollarAmountCents - Amount in **cents** (e.g. 1000 = $10.00).
 */
export async function buyShares(
  userId: string,
  marketId: string,
  outcomeId: string,
  dollarAmountCents: number
): Promise<BuySharesResult> {
  if (dollarAmountCents <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Amount must be greater than zero.",
    });
  }
  const dollarAmount = dollarAmountCents / 100;

  // ----------------------------------------------------------------
  // Step 1: Pre-flight validation (fast-fail before acquiring locks)
  // ----------------------------------------------------------------
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { status: true, openedAt: true, bFloorOverride: true },
  });
  if (!market) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Market not found." });
  }
  if (market.status !== "ACTIVE") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Market is not active.",
    });
  }

  const [preBalance, preSpend] = await Promise.all([
    getUserBalance(userId, prisma),
    getUserMarketSpend(userId, marketId, prisma),
  ]);
  if (preBalance < dollarAmount) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Insufficient balance.",
    });
  }
  if (preSpend + dollarAmount > MAX_MARKET_SPEND_DOLLARS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `$${MAX_MARKET_SPEND_DOLLARS} per-market cap exceeded.`,
    });
  }

  // ----------------------------------------------------------------
  // Steps 2–11: Interactive Postgres transaction
  // ----------------------------------------------------------------
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient): Promise<BuySharesResult> => {
      // Step 3a: Lock user row — serialises concurrent purchases by same user
      await tx.$queryRaw`
        SELECT id FROM users WHERE id = ${userId} FOR UPDATE
      `;

      // Step 3b: Lock all outcome rows for this market (atomic LMSR state)
      const outcomes = await tx.$queryRaw<OutcomeRow[]>`
        SELECT id, label, position, shares_sold
        FROM outcomes
        WHERE market_id = ${marketId}
        ORDER BY position ASC
        FOR UPDATE
      `;

      if (outcomes.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No outcomes found for market.",
        });
      }
      const targetIdx = outcomes.findIndex(
        (o: OutcomeRow) => o.id === outcomeId
      );
      if (targetIdx === -1) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Outcome does not belong to this market.",
        });
      }

      // Step 4: Re-validate under lock (authoritative check)
      const [lockedBalance, lockedSpend] = await Promise.all([
        getUserBalance(userId, tx),
        getUserMarketSpend(userId, marketId, tx),
      ]);
      if (lockedBalance < dollarAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient balance.",
        });
      }
      if (lockedSpend + dollarAmount > MAX_MARKET_SPEND_DOLLARS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `$${MAX_MARKET_SPEND_DOLLARS} per-market cap exceeded.`,
        });
      }

      // Step 5: Adaptive b
      const b = await computeAdaptiveB(
        market.openedAt,
        market.bFloorOverride,
        marketId,
        tx
      );

      // Step 6: LMSR binary-search for shares
      const q = outcomes.map((o: OutcomeRow) =>
        toNumber(o.shares_sold)
      );
      const priceBefore = allPrices(q, b)[targetIdx]!;
      const shares = computeSharesForDollarAmount(
        q,
        b,
        targetIdx,
        dollarAmount
      );

      // Step 7: Update sharesSold
      const newSharesSold = q[targetIdx]! + shares;
      await tx.outcome.update({
        where: { id: outcomeId },
        data: { sharesSold: newSharesSold },
      });

      // Compute post-purchase prices for all outcomes
      const qNew = [...q];
      qNew[targetIdx] = newSharesSold;
      const newPricesArr = allPrices(qNew, b);
      const priceAfter = newPricesArr[targetIdx]!;

      // Step 8: INSERT Purchase record
      const avgPrice = shares > 0 ? dollarAmount / shares : 0;
      const purchase = await tx.purchase.create({
        data: {
          userId,
          marketId,
          outcomeId,
          shares,
          cost: dollarAmount,
          avgPrice,
          priceBefore,
          priceAfter,
          bAtPurchase: b,
        },
      });

      // Step 9: INSERT Transaction row + advance hash chain
      const createdAt = new Date();
      await appendTransactionRow(userId, dollarAmount, createdAt, tx);

      // Step 10: UPSERT Position (first buy: INSERT; repeat: shares += delta)
      await tx.position.upsert({
        where: {
          userId_marketId_outcomeId: { userId, marketId, outcomeId },
        },
        create: {
          userId,
          marketId,
          outcomeId,
          shares,
          totalCost: dollarAmount,
        },
        update: {
          shares: { increment: shares },
          totalCost: { increment: dollarAmount },
        },
      });

      // Step 11: Reconciliation — post-insert balance must not be negative
      const postBalance = await getUserBalance(userId, tx);
      if (postBalance < -0.0001) {
        throw new Error(
          `RECONCILIATION_FAILED: user ${userId} post-purchase balance ${postBalance} is negative`
        );
      }

      const newPrices = outcomes.map(
        (o: OutcomeRow, i: number) => ({
          outcomeId: o.id,
          priceDollars: newPricesArr[i] ?? 0,
        })
      );

      return {
        purchaseId: purchase.id,
        shares,
        costDollars: dollarAmount,
        bAtPurchase: b,
        priceBeforeDollars: priceBefore,
        priceAfterDollars: priceAfter,
        newPrices,
        newBalanceCents: Math.round(postBalance * 100),
      };
    },
    { timeout: 10_000 }
  );
}
