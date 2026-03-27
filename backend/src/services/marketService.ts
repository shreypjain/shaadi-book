/**
 * Market Service — Task 2.2
 *
 * Full market lifecycle: create, resolve (with 20% charity fee + hash-chain
 * transactions), pause, void (with per-user refunds), price queries.
 *
 * All monetary operations run inside Postgres transactions. The hash chain
 * started by Task 1.1 is maintained here. Full chain verification lives in
 * Task 2.3. Reconciliation invariant is checked after every payout/refund
 * batch per CLAUDE.md.
 *
 * Note: PrismaClient types are `any` (schema not yet migrated in this env),
 * so Prisma results are cast to explicit inline interfaces for type safety.
 *
 * References:
 *   PRD §3.3, §3.4 — admin market management
 *   PRD §4.2–4.3   — LMSR pricing
 *   PRD §6.2       — data model
 *   PRD §6.4       — resolution flow pseudocode
 *   PRD §7.4       — ledger guarantees
 */

import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { adaptiveB, allPrices } from "./lmsr.js";

// ---------------------------------------------------------------------------
// Inline DB-shape interfaces
// (PrismaClient is typed as `any` until migrations run; we cast to these.)
// ---------------------------------------------------------------------------

/** Value returned by Prisma for a Decimal db column */
interface PrismaDecimal {
  toNumber(): number;
  toString(): string;
}

interface DbOutcome {
  id: string;
  marketId: string;
  label: string;
  position: number;
  sharesSold: PrismaDecimal;
  isWinner: boolean | null;
}

interface DbMarket {
  id: string;
  question: string;
  status: "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED";
  createdById: string;
  openedAt: Date | null;
  scheduledOpenAt: Date | null;
  bFloorOverride: PrismaDecimal | null;
  createdAt: Date;
  resolvedAt: Date | null;
  winningOutcomeId: string | null;
  outcomes: DbOutcome[];
}

interface DbPosition {
  userId: string;
  shares: PrismaDecimal;
  totalCost: PrismaDecimal;
}

// ---------------------------------------------------------------------------
// Public return types
// ---------------------------------------------------------------------------

export interface OutcomeWithPrice {
  id: string;
  label: string;
  position: number;
  sharesSold: number;
  /** LMSR spot price in [0, 1] — implied probability */
  price: number;
  isWinner: boolean | null;
}

export interface MarketWithPrices {
  id: string;
  question: string;
  status: "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED";
  openedAt: Date | null;
  scheduledOpenAt: Date | null;
  bFloorOverride: number | null;
  createdAt: Date;
  resolvedAt: Date | null;
  winningOutcomeId: string | null;
  createdById: string;
  outcomes: OutcomeWithPrice[];
  /** Total USD volume traded in this market */
  totalVolume: number;
  /** Current adaptive-b value */
  b: number;
}

export interface ResolveResult {
  payoutCount: number;
  totalPayout: number;
  totalCharity: number;
}

export interface VoidResult {
  refundCount: number;
  totalRefunded: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All-zeros genesis hash for the first transaction in the chain */
const GENESIS_HASH = "0".repeat(64);

/** Default b_floor when not overridden per-market */
const B_FLOOR_DEFAULT = parseInt(process.env["B_FLOOR_DEFAULT"] ?? "20", 10);

/** 20% charity fee on every winning payout (PRD §7.5) */
const CHARITY_FEE_RATE = 0.2;

// ---------------------------------------------------------------------------
// Hash-chain helpers (PRD §7.4)
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256(prevHash || type || amount || userId || createdAt).
 */
function computeTxHash(
  prevHash: string,
  type: string,
  amount: string,
  userId: string,
  createdAt: string
): string {
  return crypto
    .createHash("sha256")
    .update(prevHash + type + amount + userId + createdAt)
    .digest("hex");
}

/**
 * Return the txHash of the most recently inserted transaction row, or the
 * genesis hash if no transactions exist yet.
 *
 * Must be called inside a Prisma transaction so we see our own prior inserts
 * (Postgres READ COMMITTED gives read-your-writes within a transaction).
 */
async function getLatestTxHash(
  tx: Prisma.TransactionClient
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const last = (await (tx as any).transaction.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { txHash: true },
  })) as { txHash: string } | null;
  return last?.txHash ?? GENESIS_HASH;
}

type LedgerTxType =
  | "DEPOSIT"
  | "PURCHASE"
  | "PAYOUT"
  | "CHARITY_FEE"
  | "WITHDRAWAL"
  | "REFUND";

interface InsertTxInput {
  userId: string;
  debitAccount: string;
  creditAccount: string;
  type: LedgerTxType;
  amount: number;
  /** The previous row's txHash — caller tracks this for chaining */
  prevHash: string;
}

/**
 * Insert one append-only ledger row and return its txHash so the caller can
 * chain the next insert.
 */
async function insertTransaction(
  tx: Prisma.TransactionClient,
  input: InsertTxInput
): Promise<string> {
  const createdAt = new Date();
  const txHash = computeTxHash(
    input.prevHash,
    input.type,
    input.amount.toFixed(6),
    input.userId,
    createdAt.toISOString()
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (tx as any).transaction.create({
    data: {
      userId: input.userId,
      debitAccount: input.debitAccount,
      creditAccount: input.creditAccount,
      type: input.type,
      amount: input.amount,
      prevHash: input.prevHash,
      txHash,
      createdAt,
    },
  });

  return txHash;
}

// ---------------------------------------------------------------------------
// Reconciliation check (CLAUDE.md invariant)
//
// SUM(user_balances) + SUM(charity_fees) + SUM(house_amm_pool)
//   + SUM(withdrawals) = SUM(deposits)
//
// Derivation:
//   user_balances  = deposits + payouts + refunds - purchases - withdrawals
//   house_amm_pool = purchases - payouts - refunds - charity_fees
//   lhs = user_balances + charity_fees + house_amm_pool + withdrawals = deposits
//
// This algebraic identity is the guard — any spurious money creation breaks it.
// The real runtime guard is `house_amm_pool >= 0`.
// ---------------------------------------------------------------------------

interface ReconciliationRow {
  deposits: string;
  purchases: string;
  payouts: string;
  refunds: string;
  charity_fees: string;
  withdrawals: string;
}

async function checkReconciliation(
  tx: Prisma.TransactionClient
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (tx as any).$queryRaw`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'DEPOSIT'     THEN amount ELSE 0 END), 0)::text AS deposits,
      COALESCE(SUM(CASE WHEN type = 'PURCHASE'    THEN amount ELSE 0 END), 0)::text AS purchases,
      COALESCE(SUM(CASE WHEN type = 'PAYOUT'      THEN amount ELSE 0 END), 0)::text AS payouts,
      COALESCE(SUM(CASE WHEN type = 'REFUND'      THEN amount ELSE 0 END), 0)::text AS refunds,
      COALESCE(SUM(CASE WHEN type = 'CHARITY_FEE' THEN amount ELSE 0 END), 0)::text AS charity_fees,
      COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL'  THEN amount ELSE 0 END), 0)::text AS withdrawals
    FROM transactions
  `) as ReconciliationRow[];

  if (!rows[0]) return; // no transactions yet — trivially balanced

  const d = parseFloat(rows[0].deposits);
  const pur = parseFloat(rows[0].purchases);
  const p = parseFloat(rows[0].payouts);
  const r = parseFloat(rows[0].refunds);
  const cf = parseFloat(rows[0].charity_fees);
  const w = parseFloat(rows[0].withdrawals);

  const userBalances = d - pur + p + r - w;
  const houseAmm = pur - p - r - cf;
  const lhs = userBalances + cf + houseAmm + w;

  if (Math.abs(lhs - d) > 0.01) {
    throw new Error(
      `Reconciliation invariant violated: computed ${lhs.toFixed(6)}, expected ${d.toFixed(6)}`
    );
  }

  if (houseAmm < -0.01) {
    throw new Error(
      `House AMM pool is negative (${houseAmm.toFixed(6)}). ROLLBACK.`
    );
  }
}

// ---------------------------------------------------------------------------
// Market state helpers
// ---------------------------------------------------------------------------

/**
 * Compute the current adaptive-b and LMSR prices for a market's outcomes.
 * outcomes must already be sorted by position.
 */
function computeMarketState(
  outcomes: DbOutcome[],
  openedAt: Date | null,
  bFloorOverride: PrismaDecimal | null,
  totalVolume: number
): { b: number; prices: number[] } {
  const bFloor = bFloorOverride ? bFloorOverride.toNumber() : B_FLOOR_DEFAULT;
  const dtMs = openedAt ? Math.max(0, Date.now() - openedAt.getTime()) : 0;
  const b = adaptiveB(bFloor, dtMs, totalVolume);
  const q = outcomes.map((o: DbOutcome) => o.sharesSold.toNumber());
  const prices = allPrices(q, b);
  return { b, prices };
}

/** Shape a raw market DB record into the public MarketWithPrices type. */
function toMarketWithPrices(
  market: DbMarket,
  totalVolume: number
): MarketWithPrices {
  const { b, prices } = computeMarketState(
    market.outcomes,
    market.openedAt,
    market.bFloorOverride,
    totalVolume
  );

  return {
    id: market.id,
    question: market.question,
    status: market.status,
    openedAt: market.openedAt,
    scheduledOpenAt: market.scheduledOpenAt,
    bFloorOverride: market.bFloorOverride?.toNumber() ?? null,
    createdAt: market.createdAt,
    resolvedAt: market.resolvedAt,
    winningOutcomeId: market.winningOutcomeId,
    createdById: market.createdById,
    outcomes: market.outcomes.map((o: DbOutcome, i: number) => ({
      id: o.id,
      label: o.label,
      position: o.position,
      sharesSold: o.sharesSold.toNumber(),
      price: prices[i] ?? 0,
      isWinner: o.isWinner,
    })),
    totalVolume,
    b,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a market with 2–5 outcomes.
 *
 * Status is ACTIVE immediately if scheduledOpenAt is absent or in the past;
 * PENDING otherwise (background job activates it at scheduledOpenAt and
 * broadcasts the 5-min countdown per PRD §4.5).
 */
export async function createMarket(
  adminId: string,
  question: string,
  outcomeLabels: string[],
  bFloorOverride?: number,
  scheduledOpenAt?: Date,
  ipAddress = "0.0.0.0"
): Promise<MarketWithPrices> {
  if (outcomeLabels.length < 2 || outcomeLabels.length > 5) {
    throw new Error("Markets must have 2–5 outcomes.");
  }
  if (!question.trim()) {
    throw new Error("Market question must not be empty.");
  }

  const isImmediate = !scheduledOpenAt || scheduledOpenAt <= new Date();
  const status = isImmediate ? ("ACTIVE" as const) : ("PENDING" as const);
  const openedAt = isImmediate ? new Date() : null;

  const market = (await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (await (tx as any).market.create({
        data: {
          question: question.trim(),
          status,
          createdById: adminId,
          openedAt,
          scheduledOpenAt: scheduledOpenAt ?? null,
          bFloorOverride: bFloorOverride ?? null,
          outcomes: {
            create: outcomeLabels.map((label: string, i: number) => ({
              label: label.trim(),
              position: i,
              sharesSold: 0,
            })),
          },
        },
        include: { outcomes: { orderBy: { position: "asc" } } },
      })) as DbMarket;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).adminAuditLog.create({
        data: {
          adminId,
          action: "CREATE_MARKET",
          targetId: m.id,
          metadata: {
            question: m.question,
            outcomeLabels,
            bFloorOverride: bFloorOverride ?? null,
            scheduledOpenAt: scheduledOpenAt?.toISOString() ?? null,
            status,
          },
          ipAddress,
        },
      });

      return m;
    }
  )) as DbMarket;

  return toMarketWithPrices(market, 0);
}

/**
 * Resolve a market.
 *
 * For each user holding shares of the winning outcome:
 *   gross_payout = shares × $1.00
 *   charity_fee  = gross × 0.20   (credited to charity_pool)
 *   net_payout   = gross × 0.80   (credited to user balance)
 *
 * All in one Postgres transaction with reconciliation check.
 * PRD §6.4, §7.5
 */
export async function resolveMarket(
  adminId: string,
  marketId: string,
  winningOutcomeId: string,
  ipAddress = "0.0.0.0"
): Promise<ResolveResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txAny = tx as any;

    const market = (await txAny.market.findUnique({
      where: { id: marketId },
      include: { outcomes: { orderBy: { position: "asc" } } },
    })) as DbMarket | null;

    if (!market) throw new Error("Market not found.");
    if (market.status === "RESOLVED")
      throw new Error("Market is already resolved.");
    if (market.status === "VOIDED")
      throw new Error("Cannot resolve a voided market.");

    const winningOutcome = market.outcomes.find(
      (o: DbOutcome) => o.id === winningOutcomeId
    );
    if (!winningOutcome) {
      throw new Error("winningOutcomeId does not belong to this market.");
    }

    // Step 2: Update market
    await txAny.market.update({
      where: { id: marketId },
      data: {
        status: "RESOLVED",
        winningOutcomeId,
        resolvedAt: new Date(),
      },
    });

    // Step 3: Mark winning outcome
    await txAny.outcome.update({
      where: { id: winningOutcomeId },
      data: { isWinner: true },
    });

    // Step 3: Find all positions on the winning outcome
    const winningPositions = (await txAny.position.findMany({
      where: { marketId, outcomeId: winningOutcomeId },
      select: { userId: true, shares: true },
    })) as Pick<DbPosition, "userId" | "shares">[];

    let prevHash = await getLatestTxHash(tx);
    let payoutCount = 0;
    let totalPayout = 0;
    let totalCharity = 0;

    for (const pos of winningPositions) {
      const grossPayout = pos.shares.toNumber(); // 1 share = $1.00
      if (grossPayout <= 0) continue;

      // Round to 6 decimal places to avoid float drift
      const charityFee =
        Math.round(grossPayout * CHARITY_FEE_RATE * 1_000_000) / 1_000_000;
      const netPayout =
        Math.round((grossPayout - charityFee) * 1_000_000) / 1_000_000;

      // PAYOUT: house_amm → user (net 80%)
      prevHash = await insertTransaction(tx, {
        userId: pos.userId,
        debitAccount: "house_amm",
        creditAccount: `user:${pos.userId}`,
        type: "PAYOUT",
        amount: netPayout,
        prevHash,
      });

      // CHARITY_FEE: house_amm → charity_pool (20%)
      prevHash = await insertTransaction(tx, {
        userId: pos.userId,
        debitAccount: "house_amm",
        creditAccount: "charity_pool",
        type: "CHARITY_FEE",
        amount: charityFee,
        prevHash,
      });

      payoutCount++;
      totalPayout += netPayout;
      totalCharity += charityFee;
    }

    // Step 5: Reconciliation invariant check (CLAUDE.md)
    await checkReconciliation(tx);

    // Step 7: Audit log
    await txAny.adminAuditLog.create({
      data: {
        adminId,
        action: "RESOLVE_MARKET",
        targetId: marketId,
        metadata: {
          winningOutcomeId,
          payoutCount,
          totalPayout: totalPayout.toFixed(6),
          totalCharity: totalCharity.toFixed(6),
        },
        ipAddress,
      },
    });

    return { payoutCount, totalPayout, totalCharity };
  }) as Promise<ResolveResult>;
}

/**
 * Pause a market — no new purchases accepted while PAUSED.
 * Only ACTIVE markets can be paused.
 */
export async function pauseMarket(
  adminId: string,
  marketId: string,
  ipAddress = "0.0.0.0"
): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txAny = tx as any;

    const market = (await txAny.market.findUnique({
      where: { id: marketId },
      select: { status: true },
    })) as { status: DbMarket["status"] } | null;

    if (!market) throw new Error("Market not found.");
    if (market.status !== "ACTIVE") {
      throw new Error(
        `Only ACTIVE markets can be paused. Current status: ${market.status}`
      );
    }

    await txAny.market.update({
      where: { id: marketId },
      data: { status: "PAUSED" },
    });

    await txAny.adminAuditLog.create({
      data: {
        adminId,
        action: "PAUSE_MARKET",
        targetId: marketId,
        metadata: { previousStatus: market.status },
        ipAddress,
      },
    });
  });
}

/**
 * Void a market.
 *
 * Refunds every user's total purchase cost back to their balance, resets
 * sharesSold to 0, and marks the market VOIDED.
 * No charity fee on voided markets (PRD §9.8).
 */
export async function voidMarket(
  adminId: string,
  marketId: string,
  ipAddress = "0.0.0.0"
): Promise<VoidResult> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txAny = tx as any;

    const market = (await txAny.market.findUnique({
      where: { id: marketId },
      select: { status: true },
    })) as { status: DbMarket["status"] } | null;

    if (!market) throw new Error("Market not found.");
    if (market.status === "RESOLVED")
      throw new Error("Cannot void a resolved market.");
    if (market.status === "VOIDED")
      throw new Error("Market is already voided.");

    // One REFUND per user per market (uses position.totalCost = sum of all buys)
    const positions = (await txAny.position.findMany({
      where: { marketId },
      select: { userId: true, totalCost: true },
    })) as Pick<DbPosition, "userId" | "totalCost">[];

    let prevHash = await getLatestTxHash(tx);
    let refundCount = 0;
    let totalRefunded = 0;

    for (const pos of positions) {
      const refundAmount = pos.totalCost.toNumber();
      if (refundAmount <= 0) continue;

      // REFUND: house_amm → user
      prevHash = await insertTransaction(tx, {
        userId: pos.userId,
        debitAccount: "house_amm",
        creditAccount: `user:${pos.userId}`,
        type: "REFUND",
        amount: refundAmount,
        prevHash,
      });

      refundCount++;
      totalRefunded += refundAmount;
    }

    // Reset LMSR state vector: all sharesSold → 0
    await txAny.outcome.updateMany({
      where: { marketId },
      data: { sharesSold: 0 },
    });

    await txAny.market.update({
      where: { id: marketId },
      data: { status: "VOIDED" },
    });

    // Reconciliation check
    await checkReconciliation(tx);

    await txAny.adminAuditLog.create({
      data: {
        adminId,
        action: "VOID_MARKET",
        targetId: marketId,
        metadata: {
          refundCount,
          totalRefunded: totalRefunded.toFixed(6),
        },
        ipAddress,
      },
    });

    return { refundCount, totalRefunded };
  }) as Promise<VoidResult>;
}

/**
 * Fetch a single market with current LMSR prices attached to each outcome.
 */
export async function getMarketWithPrices(
  marketId: string
): Promise<MarketWithPrices | null> {
  const market = (await prisma.market.findUnique({
    where: { id: marketId },
    include: { outcomes: { orderBy: { position: "asc" } } },
  })) as DbMarket | null;

  if (!market) return null;

  const volumeAgg = (await prisma.purchase.aggregate({
    where: { marketId },
    _sum: { cost: true },
  })) as { _sum: { cost: PrismaDecimal | null } };
  const totalVolume = volumeAgg._sum.cost?.toNumber() ?? 0;

  return toMarketWithPrices(market, totalVolume);
}

/**
 * List markets, optionally filtered by status, with current prices and volume.
 */
export async function listMarkets(
  status?: "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED"
): Promise<MarketWithPrices[]> {
  const markets = (await prisma.market.findMany({
    where: status ? { status } : undefined,
    include: { outcomes: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "desc" },
  })) as DbMarket[];

  if (markets.length === 0) return [];

  // Batch-fetch volumes for all markets in one query
  const marketIds = markets.map((m: DbMarket) => m.id);
  const volumeRows = (await prisma.purchase.groupBy({
    by: ["marketId"],
    where: { marketId: { in: marketIds } },
    _sum: { cost: true },
  })) as Array<{ marketId: string; _sum: { cost: PrismaDecimal | null } }>;

  const volumeMap = new Map<string, number>(
    volumeRows.map(
      (v: { marketId: string; _sum: { cost: PrismaDecimal | null } }): [
        string,
        number,
      ] => [v.marketId, v._sum.cost?.toNumber() ?? 0]
    )
  );

  return markets.map((market: DbMarket) =>
    toMarketWithPrices(market, volumeMap.get(market.id) ?? 0)
  );
}
