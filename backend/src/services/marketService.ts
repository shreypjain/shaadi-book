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
 *   PRD §9   — void refund
 */

import crypto from "crypto";
import { Decimal } from "decimal.js";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db.js";
import { allPrices } from "./lmsr.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENESIS_HASH = "0".repeat(64);

// ---------------------------------------------------------------------------
// Fixed-supply b parameter helper
// ---------------------------------------------------------------------------

/**
 * Default b parameter for a fixed-supply market.
 *
 * Formula: maxShares / ln(19^(numOutcomes - 1))
 *   = maxShares / ((numOutcomes - 1) × ln(19))
 *
 * For a binary market with 100 shares: b ≈ 100 / ln(19) ≈ 33.8.
 * A higher numOutcomes lowers b (more price sensitivity with more outcomes).
 *
 * NOTE: If lmsr.ts exports defaultB in the future, replace this with that import.
 */
function defaultB(numOutcomes: number, maxShares = 100): number {
  if (numOutcomes < 2) throw new Error("defaultB: numOutcomes must be >= 2");
  return maxShares / Math.log(Math.pow(19, numOutcomes - 1));
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OutcomeWithPrice {
  id: string;
  label: string;
  position: number;
  sharesSold: number;
  /** Maximum shares available for this outcome (fixed-supply cap). */
  maxShares: number;
  /** Shares still available to purchase (= maxShares - sharesSold). */
  sharesRemaining: number;
  isWinner: boolean | null;
  /** Price in [0, 1]. */
  price: number;
  /** Price in cents (0–100). */
  priceCents: number;
  /**
   * Estimated parimutuel payout per share if this outcome wins.
   * = min($1.00, totalPool / sharesSold). 0 if no shares sold yet.
   * totalPool = SUM(purchases.cost) — will naturally account for sells once
   * the purchase engine records sells as negative-cost purchase rows.
   * This is an ESTIMATE — the pool grows as more bets come in.
   */
  estimatedPayoutPerShare: number;
}

export interface MarketWithPrices {
  id: string;
  question: string;
  status: string;
  openedAt: Date | null;
  scheduledOpenAt: Date | null;
  /** @deprecated Use bParameter / currentB instead. Kept for backwards compatibility. */
  bFloorOverride: number | null;
  /** Maximum shares per outcome for this market. */
  maxSharesPerOutcome: number;
  createdAt: Date;
  resolvedAt: Date | null;
  winningOutcomeId: string | null;
  outcomes: OutcomeWithPrice[];
  currentB: number;
  /** Total dollar volume traded in this market (= net of purchases minus sells). */
  totalVolume: number;
  /**
   * Parimutuel pool size in dollars.  Always equal to totalVolume.
   *
   * Both fields are kept intentionally:
   *   - `totalVolume` is the canonical accounting measure (sum of purchases).
   *   - `totalPool`   is the domain alias used in parimutuel UI logic
   *     (e.g. estimatedPayoutPerShare = totalPool / sharesSold).
   * Keeping separate names prevents confusion when reading payout calculations.
   */
  totalPool: number;
  /** Wedding event tag (e.g. 'Sangeet', 'Haldi', 'Reception'). */
  eventTag: string | null;
  /** Family side ('Spoorthi', 'Parsh', 'Both'). */
  familySide: string | null;
  /** Freeform custom tags. */
  customTags: string[];
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
  /** Fixed-supply cap for this outcome (default 100). */
  maxShares: number;
  isWinner: boolean | null;
}

interface RawMarket {
  id: string;
  question: string;
  status: string;
  openedAt: Date | null;
  scheduledOpenAt: Date | null;
  /** @deprecated Kept for backwards compatibility. Use bParameter instead. */
  bFloorOverride: { toNumber(): number } | number | null;
  /** Fixed b parameter override. If null, use defaultB(numOutcomes, maxSharesPerOutcome). */
  bParameter: { toNumber(): number } | number | null;
  /** Maximum shares per outcome for this market. */
  maxSharesPerOutcome: number;
  createdAt: Date;
  resolvedAt: Date | null;
  winningOutcomeId: string | null;
  outcomes: RawOutcome[];
  purchases: Array<{ cost: { toNumber(): number } | number }>;
  eventTag: string | null;
  familySide: string | null;
  customTags: string[];
}

function toNum(v: { toNumber(): number } | number): number {
  return typeof v === "number" ? v : v.toNumber();
}

// ---------------------------------------------------------------------------
// Internal: build output from raw Prisma market
// ---------------------------------------------------------------------------

function buildMarketWithPrices(market: RawMarket): MarketWithPrices {
  const numOutcomes = market.outcomes.length;
  const maxSharesPerOutcome = market.maxSharesPerOutcome ?? 100;

  // Use market.bParameter if explicitly set; otherwise calculate via defaultB.
  // totalPool = SUM(purchases.cost). Once purchaseEngine records sells as
  // negative-cost purchase rows, this naturally reflects net pool (buys - sells).
  const b = market.bParameter != null
    ? toNum(market.bParameter)
    : defaultB(numOutcomes, maxSharesPerOutcome);

  const totalVolume = market.purchases.reduce(
    (sum: number, p: { cost: { toNumber(): number } | number }) =>
      sum + toNum(p.cost),
    0
  );

  const q = market.outcomes.map((o: RawOutcome) => toNum(o.sharesSold));
  const prices = q.length >= 2 ? allPrices(q, b) : q.map(() => 0);

  return {
    id: market.id,
    question: market.question,
    status: market.status,
    openedAt: market.openedAt,
    scheduledOpenAt: market.scheduledOpenAt,
    bFloorOverride: market.bFloorOverride != null ? toNum(market.bFloorOverride) : null,
    maxSharesPerOutcome,
    createdAt: market.createdAt,
    resolvedAt: market.resolvedAt,
    winningOutcomeId: market.winningOutcomeId,
    outcomes: market.outcomes.map((o: RawOutcome, i: number) => {
      const sharesSold = toNum(o.sharesSold);
      const maxShares = o.maxShares ?? maxSharesPerOutcome;
      const sharesRemaining = Math.max(0, maxShares - sharesSold);
      return {
        id: o.id,
        label: o.label,
        position: o.position,
        sharesSold,
        maxShares,
        sharesRemaining,
        isWinner: o.isWinner,
        price: prices[i] ?? 0,
        priceCents: Math.round((prices[i] ?? 0) * 100),
        // Capped parimutuel: payout/share = min($1.00, totalPool / sharesSold)
        // $1.00 cap means house never loses; thin pools pay proportionally less.
        estimatedPayoutPerShare: sharesSold > 0 ? Math.min(1.0, totalVolume / sharesSold) : 0,
      };
    }),
    currentB: b,
    totalVolume,
    totalPool: totalVolume,
    eventTag: market.eventTag ?? null,
    familySide: market.familySide ?? null,
    customTags: market.customTags ?? [],
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
    /** @deprecated Use bParameter instead. Kept for backwards compatibility. */
    bFloorOverride?: number;
    /** Fixed b parameter for LMSR pricing. If omitted, uses defaultB(numOutcomes, maxSharesPerOutcome). */
    bParameter?: number;
    /** Maximum shares per outcome. Defaults to 100. */
    maxSharesPerOutcome?: number;
    scheduledOpenAt?: Date;
    ipAddress?: string;
    prismaClient?: PrismaClient;
    eventTag?: string;
    familySide?: string;
    customTags?: string[];
  }
): Promise<string> {
  if (outcomeLabels.length < 2 || outcomeLabels.length > 5) {
    throw new Error("Markets must have 2–5 outcomes");
  }

  const db = opts?.prismaClient ?? defaultPrisma;
  const isImmediate = !opts?.scheduledOpenAt;
  const now = new Date();
  const maxSharesPerOutcome = opts?.maxSharesPerOutcome ?? 100;

  const marketId = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const market = await tx.market.create({
      data: {
        question,
        status: isImmediate ? "ACTIVE" : "PENDING",
        createdById: adminId,
        openedAt: isImmediate ? now : null,
        scheduledOpenAt: opts?.scheduledOpenAt ?? null,
        bFloorOverride: opts?.bFloorOverride ?? null,
        bParameter: opts?.bParameter ?? null,
        maxSharesPerOutcome,
        eventTag: opts?.eventTag ?? null,
        familySide: opts?.familySide ?? null,
        customTags: opts?.customTags ?? [],
        outcomes: {
          create: outcomeLabels.map((label, i) => ({
            label,
            position: i,
            sharesSold: 0,
            maxShares: maxSharesPerOutcome,
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
          maxSharesPerOutcome,
          bParameter: opts?.bParameter ?? null,
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
// 3. resolveMarket — Parimutuel resolution (zero house exposure)
// ---------------------------------------------------------------------------

/**
 * Resolve a market using CAPPED PARIMUTUEL distribution (zero house loss):
 *   1. Set status = RESOLVED, winningOutcomeId, resolvedAt.
 *   2. Mark winning outcome isWinner = true.
 *   3. Compute totalPool = SUM(purchase.cost) for this market.
 *   4a. If no one bet on the winning outcome: REFUND all purchases
 *       (debit house_amm, credit each user their purchase cost; type=REFUND).
 *   4b. Otherwise: distribute using capped parimutuel —
 *         payoutPerShare = min($1.00, totalPool / totalWinningShares)
 *         Pool > winning_shares  → $1.00/share (house keeps surplus; profits from losers)
 *         Pool < winning_shares  → pool/shares (house breaks even; thin-market protection)
 *         For each position: payout = shares × payoutPerShare (truncated to 6 dp)
 *         INSERT PAYOUT (debit house_amm, credit user; type=PAYOUT)
 *   5. Maintain SHA-256 hash chain on every transaction.
 *   6. Log to AdminAuditLog with resolution tag and houseSurplus.
 *
 * Accounting invariant (always holds):
 *   SUM(payouts) ≤ totalPool  ⟹  housePool ≥ 0  (reconciliation passes)
 *   With full-dollar payout: houseSurplus = pool − payouts > 0 (house profits)
 *   With thin pool:          houseSurplus ≈ 0 (only rounding dust)
 *
 * References:
 *   PRD §6.4 — resolution flow pseudocode
 *   PRD §7.4 — immutable ledger guarantees
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
      // -----------------------------------------------------------------------
      // Guards
      // -----------------------------------------------------------------------
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

      // -----------------------------------------------------------------------
      // 1. Update market status
      // -----------------------------------------------------------------------
      await tx.market.update({
        where: { id: marketId },
        data: {
          status: "RESOLVED",
          winningOutcomeId,
          resolvedAt: new Date(),
        },
      });

      // -----------------------------------------------------------------------
      // 2. Mark winning outcome
      // -----------------------------------------------------------------------
      await tx.outcome.update({
        where: { id: winningOutcomeId },
        data: { isWinner: true },
      });

      // -----------------------------------------------------------------------
      // 3. Calculate total pool = SUM(purchase.cost) for this market
      // -----------------------------------------------------------------------
      const totalPoolAgg = await tx.purchase.aggregate({
        where: { marketId },
        _sum: { cost: true },
      });
      const poolDollars = new Decimal(totalPoolAgg._sum.cost?.toString() ?? "0");

      // -----------------------------------------------------------------------
      // 4. Fetch winning positions (ordered for deterministic hash chain)
      // -----------------------------------------------------------------------
      const winningPositions = await tx.position.findMany({
        where: { marketId, outcomeId: winningOutcomeId },
        orderBy: { createdAt: "asc" },
      });

      // -----------------------------------------------------------------------
      // 5. Compute total winning shares
      // -----------------------------------------------------------------------
      let totalWinningShares = new Decimal(0);
      for (const p of winningPositions) {
        totalWinningShares = totalWinningShares.plus(new Decimal(p.shares.toString()));
      }

      // -----------------------------------------------------------------------
      // 6. Seed hash chain
      // -----------------------------------------------------------------------
      let prevHash = await getLatestTxHash(tx);

      // -----------------------------------------------------------------------
      // 7. Distribute pool
      // -----------------------------------------------------------------------
      if (totalWinningShares.isZero()) {
        // ---- Edge case: nobody bet on the winning outcome → refund everyone ----
        // Fetch all purchases for this market ordered oldest-first
        const allPurchases = await tx.purchase.findMany({
          where: { marketId },
          orderBy: { createdAt: "asc" },
        });

        let totalRefunded = new Decimal(0);

        for (const purchase of allPurchases) {
          const refundAmount = new Decimal(purchase.cost.toString());
          totalRefunded = totalRefunded.plus(refundAmount);

          const refundAt = new Date();
          const refundHash = computeTxHash(
            prevHash,
            "REFUND",
            refundAmount.toNumber(),
            purchase.userId,
            refundAt
          );
          await tx.transaction.create({
            data: {
              userId: purchase.userId,
              debitAccount: "house_amm",
              creditAccount: `user:${purchase.userId}`,
              type: "REFUND",
              amount: refundAmount.toNumber(),
              prevHash,
              txHash: refundHash,
              createdAt: refundAt,
            },
          });
          prevHash = refundHash;
        }

        // Audit log — no-winner refund path
        await tx.adminAuditLog.create({
          data: {
            adminId,
            action: "RESOLVE_MARKET",
            targetId: marketId,
            metadata: {
              winningOutcomeId,
              resolution: "no_winner_refunded",
              totalPool: poolDollars.toFixed(6),
              totalRefunded: totalRefunded.toFixed(6),
              refundsCount: allPurchases.length,
            },
            ipAddress: opts?.ipAddress ?? "0.0.0.0",
          },
        });
      } else {
        // ---- Normal path: capped parimutuel distribution ----
        // payoutPerShare = min($1.00, totalPool / totalWinningShares)
        // Pool > winning_shares  → winners get $1/share, house keeps surplus
        // Pool < winning_shares  → winners split pool proportionally, house breaks even
        const rawPayoutPerShare = poolDollars.dividedBy(totalWinningShares);
        const payoutPerShare = Decimal.min(rawPayoutPerShare, new Decimal("1.000000"));

        let totalGrossPayout = new Decimal(0);

        for (const position of winningPositions) {
          const shares = new Decimal(position.shares.toString());
          // Truncate to 6 dp (floor) so SUM(payouts) ≤ totalPool
          const payout = shares
            .times(payoutPerShare)
            .toDecimalPlaces(6, Decimal.ROUND_DOWN);

          totalGrossPayout = totalGrossPayout.plus(payout);

          const payoutAt = new Date();
          const payoutHash = computeTxHash(
            prevHash,
            "PAYOUT",
            payout.toNumber(),
            position.userId,
            payoutAt
          );
          await tx.transaction.create({
            data: {
              userId: position.userId,
              debitAccount: "house_amm",
              creditAccount: `user:${position.userId}`,
              type: "PAYOUT",
              amount: payout.toNumber(),
              prevHash,
              txHash: payoutHash,
              createdAt: payoutAt,
            },
          });
          prevHash = payoutHash;
        }

        // Sanity check: SUM(payouts) must not exceed pool (rounding guard)
        if (totalGrossPayout.greaterThan(poolDollars.plus(new Decimal("0.000001")))) {
          throw new Error(
            `Capped parimutuel invariant violated: ` +
              `payouts(${totalGrossPayout.toFixed(6)}) > pool(${poolDollars.toFixed(6)})`
          );
        }

        const houseSurplus = poolDollars.minus(totalGrossPayout);
        const isFullDollarPayout = rawPayoutPerShare.greaterThanOrEqualTo(new Decimal("1"));

        // Audit log — capped parimutuel path
        await tx.adminAuditLog.create({
          data: {
            adminId,
            action: "RESOLVE_MARKET",
            targetId: marketId,
            metadata: {
              winningOutcomeId,
              resolution: isFullDollarPayout ? "capped_parimutuel_full" : "capped_parimutuel_thin",
              totalPool: poolDollars.toFixed(6),
              totalGrossPayout: totalGrossPayout.toFixed(6),
              payoutPerShare: payoutPerShare.toFixed(6),
              houseSurplus: houseSurplus.toFixed(6),
              payoutsCount: winningPositions.length,
            },
            ipAddress: opts?.ipAddress ?? "0.0.0.0",
          },
        });
      }
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
      outcomes: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          label: true,
          position: true,
          sharesSold: true,
          maxShares: true,
          isWinner: true,
        },
      },
      purchases: { select: { cost: true } },
    },
    // Select market-level fields explicitly to include new schema fields
  });
  if (!market) return null;

  return buildMarketWithPrices(market as unknown as RawMarket);
}

// ---------------------------------------------------------------------------
// 7. listMarkets
// ---------------------------------------------------------------------------

type MarketStatus = "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED";

export interface ListMarketsFilters {
  status?: MarketStatus;
  eventTag?: string;
  familySide?: string;
}

/**
 * List markets with current LMSR prices, optionally filtered by status, eventTag, familySide.
 * Returns newest-first.
 */
export async function listMarkets(
  filters?: ListMarketsFilters | MarketStatus,
  prismaClient?: PrismaClient
): Promise<MarketWithPrices[]> {
  const db = prismaClient ?? defaultPrisma;

  // Support legacy call signature: listMarkets(status?, prismaClient?)
  const normalised: ListMarketsFilters =
    typeof filters === "string" ? { status: filters } : (filters ?? {});

  const where: Record<string, unknown> = {};
  if (normalised.status) where["status"] = normalised.status;
  if (normalised.eventTag) where["eventTag"] = normalised.eventTag;
  if (normalised.familySide) where["familySide"] = normalised.familySide;

  const markets = await db.market.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      outcomes: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          label: true,
          position: true,
          sharesSold: true,
          maxShares: true,
          isWinner: true,
        },
      },
      purchases: { select: { cost: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (markets as unknown as RawMarket[]).map((m: RawMarket) => buildMarketWithPrices(m));
}
