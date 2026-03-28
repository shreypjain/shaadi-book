/**
 * Market Service — Task 2.2
 *
 * Full market lifecycle: create, open, resolve, pause, void.
 * All monetary operations run inside Postgres transactions.
 * resolveMarket / voidMarket use Serializable isolation.
 *
 * References:
 *   PRD §3.3 — market creation
 *   PRD §3.4 — market resolution
 *   PRD §6.4 — resolution flow pseudocode
 *   PRD §9   — void refund, no charity fee on void
 */

import crypto from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db.js";
import { allPrices, adaptiveB } from "./lmsr.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENESIS_HASH = "0".repeat(64);
const B_FLOOR_DEFAULT = 20;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OutcomeWithPrice {
  id: string;
  label: string;
  position: number;
  sharesSold: number;
  isWinner: boolean | null;
  /** Price in [0, 1]. */
  price: number;
  /** Price in cents (0–100). */
  priceCents: number;
}

export interface MarketWithPrices {
  id: string;
  question: string;
  status: string;
  openedAt: Date | null;
  scheduledOpenAt: Date | null;
  bFloorOverride: number | null;
  createdAt: Date;
  resolvedAt: Date | null;
  winningOutcomeId: string | null;
  outcomes: OutcomeWithPrice[];
  currentB: number;
  /** Total dollar volume traded in this market. */
  totalVolume: number;
}

// ---------------------------------------------------------------------------
// Hash-chain helpers
// ---------------------------------------------------------------------------

/**
 * SHA-256 hash for a ledger row.
 * Content: prevHash | type | amount | userId | createdAt (ISO)
 */
function computeTxHash(
  prevHash: string,
  type: string,
  amount: number,
  userId: string,
  createdAt: Date
): string {
  const payload = [
    prevHash,
    type,
    amount.toFixed(6),
    userId,
    createdAt.toISOString(),
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Retrieve the most-recent transaction's hash to start a new chain link.
 * Prisma.TransactionClient is typed as `any` so this works inside $transaction.
 */
async function getLatestTxHash(tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.transaction.findFirst({
    orderBy: { createdAt: "desc" },
    select: { txHash: true },
  });
  return (last?.txHash as string | undefined) ?? GENESIS_HASH;
}

// ---------------------------------------------------------------------------
// Internal: raw Prisma market shape (after include: outcomes + purchases)
// ---------------------------------------------------------------------------

interface RawOutcome {
  id: string;
  label: string;
  position: number;
  sharesSold: { toNumber(): number } | number;
  isWinner: boolean | null;
}

interface RawMarket {
  id: string;
  question: string;
  status: string;
  openedAt: Date | null;
  scheduledOpenAt: Date | null;
  bFloorOverride: { toNumber(): number } | number | null;
  createdAt: Date;
  resolvedAt: Date | null;
  winningOutcomeId: string | null;
  outcomes: RawOutcome[];
  purchases: Array<{ cost: { toNumber(): number } | number }>;
}

function toNum(v: { toNumber(): number } | number): number {
  return typeof v === "number" ? v : v.toNumber();
}

// ---------------------------------------------------------------------------
// Internal: build output from raw Prisma market
// ---------------------------------------------------------------------------

function buildMarketWithPrices(market: RawMarket): MarketWithPrices {
  const bFloor = market.bFloorOverride != null
    ? toNum(market.bFloorOverride)
    : B_FLOOR_DEFAULT;

  const totalVolume = market.purchases.reduce(
    (sum: number, p: { cost: { toNumber(): number } | number }) =>
      sum + toNum(p.cost),
    0
  );

  const dtMs = market.openedAt
    ? Math.max(0, Date.now() - market.openedAt.getTime())
    : 0;

  const b = adaptiveB(bFloor, dtMs, totalVolume);
  const q = market.outcomes.map((o: RawOutcome) => toNum(o.sharesSold));
  const prices = q.length >= 2 ? allPrices(q, b) : q.map(() => 0);

  return {
    id: market.id,
    question: market.question,
    status: market.status,
    openedAt: market.openedAt,
    scheduledOpenAt: market.scheduledOpenAt,
    bFloorOverride: market.bFloorOverride != null ? toNum(market.bFloorOverride) : null,
    createdAt: market.createdAt,
    resolvedAt: market.resolvedAt,
    winningOutcomeId: market.winningOutcomeId,
    outcomes: market.outcomes.map((o: RawOutcome, i: number) => ({
      id: o.id,
      label: o.label,
      position: o.position,
      sharesSold: toNum(o.sharesSold),
      isWinner: o.isWinner,
      price: prices[i] ?? 0,
      priceCents: Math.round((prices[i] ?? 0) * 100),
    })),
    currentB: b,
    totalVolume,
  };
}

// ---------------------------------------------------------------------------
// 1. createMarket
// ---------------------------------------------------------------------------

/**
 * Create a market with 2–5 outcomes.
 *
 * If scheduledOpenAt is provided the market starts as PENDING (openedAt = null).
 * Otherwise it starts as ACTIVE (openedAt = now).
 *
 * Logs to AdminAuditLog. Returns the new market ID.
 */
export async function createMarket(
  adminId: string,
  question: string,
  outcomeLabels: string[],
  opts?: {
    bFloorOverride?: number;
    scheduledOpenAt?: Date;
    ipAddress?: string;
    prismaClient?: PrismaClient;
  }
): Promise<string> {
  if (outcomeLabels.length < 2 || outcomeLabels.length > 5) {
    throw new Error("Markets must have 2–5 outcomes");
  }

  const db = opts?.prismaClient ?? defaultPrisma;
  const isImmediate = !opts?.scheduledOpenAt;
  const now = new Date();

  const marketId = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const market = await tx.market.create({
      data: {
        question,
        status: isImmediate ? "ACTIVE" : "PENDING",
        createdById: adminId,
        openedAt: isImmediate ? now : null,
        scheduledOpenAt: opts?.scheduledOpenAt ?? null,
        bFloorOverride: opts?.bFloorOverride ?? null,
        outcomes: {
          create: outcomeLabels.map((label, i) => ({
            label,
            position: i,
            sharesSold: 0,
          })),
        },
      },
      select: { id: true },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: "CREATE_MARKET",
        targetId: market.id,
        metadata: {
          question,
          outcomeLabels,
          isImmediate,
          scheduledOpenAt: opts?.scheduledOpenAt?.toISOString() ?? null,
          bFloorOverride: opts?.bFloorOverride ?? null,
        },
        ipAddress: opts?.ipAddress ?? "0.0.0.0",
      },
    });

    return market.id;
  });

  return marketId;
}

// ---------------------------------------------------------------------------
// 2. openMarket
// ---------------------------------------------------------------------------

/**
 * Transition a PENDING market to ACTIVE and set openedAt = now.
 * Called by the scheduler when a scheduled market's open time arrives.
 */
export async function openMarket(
  marketId: string,
  prismaClient?: PrismaClient
): Promise<void> {
  const db = prismaClient ?? defaultPrisma;
  const market = await db.market.findUnique({
    where: { id: marketId },
    select: { status: true },
  });
  if (!market) throw new Error(`Market ${marketId} not found`);
  if (market.status !== "PENDING") {
    throw new Error(
      `Market ${marketId} is not PENDING (status=${market.status})`
    );
  }
  await db.market.update({
    where: { id: marketId },
    data: { status: "ACTIVE", openedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// 3. resolveMarket — PRD §6.4
// ---------------------------------------------------------------------------

/**
 * Resolve a market in a single Serializable transaction:
 *   1. Set status = RESOLVED, winningOutcomeId, resolvedAt.
 *   2. Mark winning outcome isWinner = true.
 *   3. For each position on the winning outcome:
 *        payout = shares × $1.00  (full $1.00 per share, no charity fee at resolution)
 *        INSERT PAYOUT (credit user, debit house_amm)
 *   4. Append hash chain.
 *   5. Log to AdminAuditLog.
 */
export async function resolveMarket(
  adminId: string,
  marketId: string,
  winningOutcomeId: string,
  opts?: { ipAddress?: string; prismaClient?: PrismaClient }
): Promise<void> {
  const db = opts?.prismaClient ?? defaultPrisma;

  await db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Guards
      const market = await tx.market.findUnique({
        where: { id: marketId },
        include: { outcomes: true },
      });
      if (!market) throw new Error(`Market ${marketId} not found`);
      if (market.status === "RESOLVED") throw new Error("Market is already resolved");
      if (market.status === "VOIDED") throw new Error("Cannot resolve a voided market");

      const winningOutcome = market.outcomes.find(
        (o: { id: string }) => o.id === winningOutcomeId
      );
      if (!winningOutcome) {
        throw new Error(
          `Outcome ${winningOutcomeId} does not belong to market ${marketId}`
        );
      }

      // 1. Update market
      await tx.market.update({
        where: { id: marketId },
        data: {
          status: "RESOLVED",
          winningOutcomeId,
          resolvedAt: new Date(),
        },
      });

      // 2. Mark winning outcome
      await tx.outcome.update({
        where: { id: winningOutcomeId },
        data: { isWinner: true },
      });

      // 3. Fetch winning positions
      const winningPositions = await tx.position.findMany({
        where: { marketId, outcomeId: winningOutcomeId },
        orderBy: { createdAt: "asc" },
      });

      // 4. Seed hash chain
      let prevHash = await getLatestTxHash(tx);

      // 5. Payout loop
      let totalGross = 0;

      for (const position of winningPositions) {
        const shares = Number(position.shares);
        // Round to 6 dp to match DB precision
        const gross = parseFloat(shares.toFixed(6));

        totalGross = parseFloat((totalGross + gross).toFixed(6));

        // PAYOUT transaction — full $1.00 per share, no charity deduction at resolution
        const payoutAt = new Date();
        const payoutHash = computeTxHash(prevHash, "PAYOUT", gross, position.userId, payoutAt);
        await tx.transaction.create({
          data: {
            userId: position.userId,
            debitAccount: "house_amm",
            creditAccount: `user:${position.userId}`,
            type: "PAYOUT",
            amount: gross,
            prevHash,
            txHash: payoutHash,
            createdAt: payoutAt,
          },
        });
        prevHash = payoutHash;
      }

      // 6. Audit log
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "RESOLVE_MARKET",
          targetId: marketId,
          metadata: {
            winningOutcomeId,
            totalGrossPayout: totalGross,
            payoutsCount: winningPositions.length,
          },
          ipAddress: opts?.ipAddress ?? "0.0.0.0",
        },
      });
    },
    { isolationLevel: "Serializable" }
  );
}

// ---------------------------------------------------------------------------
// 4. pauseMarket
// ---------------------------------------------------------------------------

/**
 * Pause an ACTIVE market (halts new purchases).
 */
export async function pauseMarket(
  adminId: string,
  marketId: string,
  opts?: { ipAddress?: string; prismaClient?: PrismaClient }
): Promise<void> {
  const db = opts?.prismaClient ?? defaultPrisma;

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const market = await tx.market.findUnique({
      where: { id: marketId },
      select: { status: true },
    });
    if (!market) throw new Error(`Market ${marketId} not found`);
    if (market.status !== "ACTIVE") {
      throw new Error(
        `Only ACTIVE markets can be paused (status=${market.status})`
      );
    }

    await tx.market.update({
      where: { id: marketId },
      data: { status: "PAUSED" },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: "PAUSE_MARKET",
        targetId: marketId,
        metadata: { previousStatus: market.status },
        ipAddress: opts?.ipAddress ?? "0.0.0.0",
      },
    });
  });
}

// ---------------------------------------------------------------------------
// 5. voidMarket
// ---------------------------------------------------------------------------

/**
 * Void a market — refund all purchases, reset outcomes, log audit.
 *
 * No charity fee on voided markets (PRD §9 rule 8).
 * Runs in a Serializable transaction.
 */
export async function voidMarket(
  adminId: string,
  marketId: string,
  opts?: { ipAddress?: string; prismaClient?: PrismaClient }
): Promise<void> {
  const db = opts?.prismaClient ?? defaultPrisma;

  await db.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const market = await tx.market.findUnique({
        where: { id: marketId },
        include: { outcomes: true },
      });
      if (!market) throw new Error(`Market ${marketId} not found`);
      if (market.status === "RESOLVED") throw new Error("Cannot void a resolved market");
      if (market.status === "VOIDED") throw new Error("Market is already voided");

      // Fetch all purchases ordered oldest-first (deterministic hash chain)
      const purchases = await tx.purchase.findMany({
        where: { marketId },
        orderBy: { createdAt: "asc" },
      });

      let prevHash = await getLatestTxHash(tx);
      let totalPurchaseCost = 0;
      let totalRefunded = 0;

      for (const purchase of purchases) {
        const refundAmount = parseFloat(Number(purchase.cost).toFixed(6));
        totalPurchaseCost = parseFloat((totalPurchaseCost + refundAmount).toFixed(6));
        totalRefunded = parseFloat((totalRefunded + refundAmount).toFixed(6));

        const refundAt = new Date();
        const refundHash = computeTxHash(
          prevHash,
          "REFUND",
          refundAmount,
          purchase.userId,
          refundAt
        );
        await tx.transaction.create({
          data: {
            userId: purchase.userId,
            debitAccount: "house_amm",
            creditAccount: `user:${purchase.userId}`,
            type: "REFUND",
            amount: refundAmount,
            prevHash,
            txHash: refundHash,
            createdAt: refundAt,
          },
        });
        prevHash = refundHash;
      }

      // Reset sharesSold on all outcomes
      for (const outcome of market.outcomes) {
        await tx.outcome.update({
          where: { id: outcome.id },
          data: { sharesSold: 0 },
        });
      }

      // Void the market
      await tx.market.update({
        where: { id: marketId },
        data: { status: "VOIDED" },
      });

      // Reconciliation: sum(refunds) must equal sum(purchases)
      const diff = Math.abs(totalRefunded - totalPurchaseCost);
      if (diff > 0.001) {
        throw new Error(
          `Void reconciliation failed: refunded(${totalRefunded}) ≠ purchased(${totalPurchaseCost})`
        );
      }

      // Audit log
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "VOID_MARKET",
          targetId: marketId,
          metadata: { totalRefunded, purchasesCount: purchases.length },
          ipAddress: opts?.ipAddress ?? "0.0.0.0",
        },
      });
    },
    { isolationLevel: "Serializable" }
  );
}

// ---------------------------------------------------------------------------
// 6. getMarketWithPrices
// ---------------------------------------------------------------------------

/**
 * Return a single market with current LMSR prices for all outcomes.
 */
export async function getMarketWithPrices(
  marketId: string,
  prismaClient?: PrismaClient
): Promise<MarketWithPrices | null> {
  const db = prismaClient ?? defaultPrisma;

  const market = await db.market.findUnique({
    where: { id: marketId },
    include: {
      outcomes: { orderBy: { position: "asc" } },
      purchases: { select: { cost: true } },
    },
  });
  if (!market) return null;

  return buildMarketWithPrices(market as RawMarket);
}

// ---------------------------------------------------------------------------
// 7. listMarkets
// ---------------------------------------------------------------------------

type MarketStatus = "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED";

/**
 * List markets with current LMSR prices, optionally filtered by status.
 * Returns newest-first.
 */
export async function listMarkets(
  status?: MarketStatus,
  prismaClient?: PrismaClient
): Promise<MarketWithPrices[]> {
  const db = prismaClient ?? defaultPrisma;

  const markets = await db.market.findMany({
    where: status ? { status } : undefined,
    include: {
      outcomes: { orderBy: { position: "asc" } },
      purchases: { select: { cost: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (markets as RawMarket[]).map((m: RawMarket) => buildMarketWithPrices(m));
}
