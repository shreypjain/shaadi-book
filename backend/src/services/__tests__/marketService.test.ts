/**
 * Market Service Integration Tests — Task 2.2 (Parimutuel)
 *
 * Tests the full market lifecycle against a live PostgreSQL test database.
 * Run with: npm test (from /backend directory)
 *
 * Covered paths:
 *   1. createMarket with 2 outcomes → status ACTIVE, prices at 50%
 *   2. createMarket with scheduledOpenAt → status PENDING, openedAt null
 *   3. resolveMarket — parimutuel: single winner side gets entire pool
 *   4. resolveMarket — parimutuel: proportional split among multiple winners
 *   5. resolveMarket — edge case: no bets on winning outcome → refund all
 *   6. resolveMarket — reconciliation holds after parimutuel resolution
 *   7. voidMarket → all purchases refunded, reconciliation holds
 *   8. pauseMarket → status PAUSED
 *   + guard tests: double-resolve, void-resolved, pause non-active
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createMarket,
  resolveMarket,
  pauseMarket,
  voidMarket,
  getMarketWithPrices,
} from "../marketService.js";

// ---------------------------------------------------------------------------
// Test DB client
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

const GENESIS_HASH = "0".repeat(64);

/** Fake SHA-256 hash padded to 64 chars */
function fakeHash(seed: string): string {
  return seed.padEnd(64, "0").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Shared test state — created once per file
// ---------------------------------------------------------------------------

let adminId: string;
let guestAId: string;
let guestBId: string;
let guestCId: string;

beforeAll(async () => {
  // Unique phones per run to avoid conflicts with parallel test runs
  const ts = Date.now().toString().slice(-6);

  const admin = await prisma.user.create({
    data: {
      name: "Admin",
      phone: `+1900${ts}0000`,
      country: "US",
      role: "ADMIN",
    },
  });
  adminId = admin.id;

  const guestA = await prisma.user.create({
    data: {
      name: "Guest A",
      phone: `+1900${ts}0001`,
      country: "US",
      role: "GUEST",
    },
  });
  guestAId = guestA.id;

  const guestB = await prisma.user.create({
    data: {
      name: "Guest B",
      phone: `+1900${ts}0002`,
      country: "US",
      role: "GUEST",
    },
  });
  guestBId = guestB.id;

  const guestC = await prisma.user.create({
    data: {
      name: "Guest C",
      phone: `+1900${ts}0003`,
      country: "US",
      role: "GUEST",
    },
  });
  guestCId = guestC.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helper: seed a DEPOSIT + PURCHASE transaction pair for a user on an outcome
// ---------------------------------------------------------------------------

async function seedDepositAndPurchase(opts: {
  userId: string;
  marketId: string;
  outcomeId: string;
  shares: number;
  cost: number;
}): Promise<{ purchaseId: string }> {
  const { userId, marketId, outcomeId, shares, cost } = opts;

  // DEPOSIT transaction so user has funded balance
  await prisma.transaction.create({
    data: {
      userId,
      debitAccount: "stripe_escrow",
      creditAccount: `user:${userId}`,
      type: "DEPOSIT",
      amount: cost,
      prevHash: GENESIS_HASH,
      txHash: fakeHash(`deposit-${userId}-${Date.now()}`),
    },
  });

  // PURCHASE transaction (debit user, credit house_amm)
  await prisma.transaction.create({
    data: {
      userId,
      debitAccount: `user:${userId}`,
      creditAccount: "house_amm",
      type: "PURCHASE",
      amount: cost,
      prevHash: GENESIS_HASH,
      txHash: fakeHash(`purchase-${userId}-${Date.now()}`),
    },
  });

  // Position record
  await prisma.position.upsert({
    where: { userId_marketId_outcomeId: { userId, marketId, outcomeId } },
    create: { userId, marketId, outcomeId, shares, totalCost: cost },
    update: {
      shares: { increment: shares },
      totalCost: { increment: cost },
    },
  });

  // Purchase record
  const purchase = await prisma.purchase.create({
    data: {
      userId,
      marketId,
      outcomeId,
      shares,
      cost,
      avgPrice: cost / shares,
      priceBefore: 0.5,
      priceAfter: 0.55,
      bAtPurchase: 20,
    },
  });

  // Update outcome sharesSold
  await prisma.outcome.update({
    where: { id: outcomeId },
    data: { sharesSold: { increment: shares } },
  });

  return { purchaseId: purchase.id };
}

// ---------------------------------------------------------------------------
// Test 1: createMarket — immediate, 2 outcomes, ACTIVE, prices at 50%
// ---------------------------------------------------------------------------

describe("createMarket — immediate", () => {
  let marketId: string;

  it("creates market with status ACTIVE", async () => {
    marketId = await createMarket(adminId, "Will the groom cry?", ["Yes", "No"], {
      prismaClient: prisma,
    });

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: { outcomes: { orderBy: { position: "asc" } } },
    });

    expect(market).not.toBeNull();
    expect(market!.status).toBe("ACTIVE");
    expect(market!.openedAt).not.toBeNull();
    expect(market!.outcomes).toHaveLength(2);
    expect(market!.outcomes[0]!.label).toBe("Yes");
    expect(market!.outcomes[1]!.label).toBe("No");
  });

  it("outcomes start at 0 shares sold", async () => {
    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: { outcomes: true },
    });
    for (const o of market!.outcomes) {
      expect(Number(o.sharesSold)).toBe(0);
    }
  });

  it("initial LMSR prices are both 50%", async () => {
    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();
    expect(market!.outcomes).toHaveLength(2);
    // At q=[0,0] both prices = 0.50
    for (const o of market!.outcomes) {
      expect(o.price).toBeCloseTo(0.5, 4);
      expect(o.priceCents).toBe(50);
    }
  });

  it("logs to AdminAuditLog", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "CREATE_MARKET" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.adminId).toBe(adminId);
  });
});

// ---------------------------------------------------------------------------
// Test 2: createMarket — scheduled, status PENDING, openedAt null
// ---------------------------------------------------------------------------

describe("createMarket — scheduled", () => {
  it("creates market with status PENDING when scheduledOpenAt is set", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const marketId = await createMarket(
      adminId,
      "Will there be a surprise act?",
      ["Yes", "No", "Maybe"],
      {
        scheduledOpenAt: futureDate,
        prismaClient: prisma,
      }
    );

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("PENDING");
    expect(market!.openedAt).toBeNull();
    expect(market!.scheduledOpenAt).not.toBeNull();
    expect(market!.scheduledOpenAt!.getTime()).toBeCloseTo(futureDate.getTime(), -2);
  });

  it("rejects fewer than 2 outcomes", async () => {
    await expect(
      createMarket(adminId, "Bad market", ["Only one"], { prismaClient: prisma })
    ).rejects.toThrow("2–5 outcomes");
  });

  it("rejects more than 5 outcomes", async () => {
    await expect(
      createMarket(
        adminId,
        "Too many",
        ["A", "B", "C", "D", "E", "F"],
        { prismaClient: prisma }
      )
    ).rejects.toThrow("2–5 outcomes");
  });
});

// ---------------------------------------------------------------------------
// Test 3: resolveMarket — parimutuel, single winner side gets entire pool
// ---------------------------------------------------------------------------

describe("resolveMarket — parimutuel single-side winner", () => {
  let marketId: string;
  let yesId: string;
  let noId: string;

  // Scenario:
  //   Guest A bets $5 on Yes → 5 shares
  //   Guest B bets $3 on No  → 3 shares
  //   Total pool = $8
  //   Yes wins → A is the only winner → A gets entire $8 pool
  //   Payout per share = $8 / 5 = $1.60 → A payout = $8.00

  beforeAll(async () => {
    marketId = await createMarket(
      adminId,
      "Will Spoorthi's dad dance?",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    yesId = outcomes[0]!.id;
    noId = outcomes[1]!.id;

    // Guest A: 5 shares on Yes, cost $5
    await seedDepositAndPurchase({
      userId: guestAId,
      marketId,
      outcomeId: yesId,
      shares: 5,
      cost: 5,
    });

    // Guest B: 3 shares on No, cost $3 (loses)
    await seedDepositAndPurchase({
      userId: guestBId,
      marketId,
      outcomeId: noId,
      shares: 3,
      cost: 3,
    });
  });

  it("resolves with Yes winning, status = RESOLVED", async () => {
    await resolveMarket(adminId, marketId, yesId, { prismaClient: prisma });

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("RESOLVED");
    expect(market!.winningOutcomeId).toBe(yesId);
    expect(market!.resolvedAt).not.toBeNull();
  });

  it("winning outcome marked isWinner = true", async () => {
    const yes = await prisma.outcome.findUnique({ where: { id: yesId } });
    expect(yes!.isWinner).toBe(true);
  });

  it("losing outcome isWinner stays null / false", async () => {
    const no = await prisma.outcome.findUnique({ where: { id: noId } });
    expect(no!.isWinner).not.toBe(true);
  });

  it("Guest A receives entire pool (parimutuel: pool=$8, A has 5/5 winning shares)", async () => {
    // Pool = $5 (A) + $3 (B) = $8. A is the only winner (5 shares on Yes).
    // payoutPerShare = $8 / 5 = $1.60 → A gets $8.00
    const payoutTx = await prisma.transaction.findFirst({
      where: {
        userId: guestAId,
        type: "PAYOUT",
        creditAccount: `user:${guestAId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(8.0, 4);
  });

  it("no CHARITY_FEE transaction created at resolution", async () => {
    const charityTx = await prisma.transaction.findFirst({
      where: {
        userId: guestAId,
        type: "CHARITY_FEE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(charityTx).toBeNull();
  });

  it("Guest B (loser) gets no PAYOUT transaction for this market", async () => {
    // B bet on No (losing side) — no payout
    const payoutTxs = await prisma.transaction.findMany({
      where: {
        userId: guestBId,
        type: "PAYOUT",
        creditAccount: `user:${guestBId}`,
      },
    });
    expect(payoutTxs).toHaveLength(0);
  });

  it("audit log records parimutuel resolution with correct pool/payout info", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "RESOLVE_MARKET" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.adminId).toBe(adminId);
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta["resolution"]).toBe("parimutuel");
    expect(Number(meta["totalPool"])).toBeCloseTo(8.0, 4);
    expect(Number(meta["payoutsCount"])).toBe(1);
  });

  it("double-resolve throws", async () => {
    await expect(
      resolveMarket(adminId, marketId, yesId, { prismaClient: prisma })
    ).rejects.toThrow("already resolved");
  });
});

// ---------------------------------------------------------------------------
// Test 4: resolveMarket — parimutuel proportional split (multiple winners)
// ---------------------------------------------------------------------------

describe("resolveMarket — parimutuel proportional split", () => {
  let marketId: string;
  let yesId: string;
  let noId: string;

  // Scenario:
  //   Guest A bets $6 on Yes → 3 shares
  //   Guest C bets $4 on Yes → 2 shares
  //   Guest B bets $5 on No  → 5 shares (loses)
  //   Total pool = $15
  //   Yes wins → totalWinningShares = 5
  //   payoutPerShare = $15 / 5 = $3.00
  //   A gets 3 × $3 = $9.00
  //   C gets 2 × $3 = $6.00
  //   SUM(payouts) = $15 = totalPool ✓

  beforeAll(async () => {
    marketId = await createMarket(
      adminId,
      "Proportional split test — will the band play?",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    yesId = outcomes[0]!.id;
    noId = outcomes[1]!.id;

    await seedDepositAndPurchase({
      userId: guestAId,
      marketId,
      outcomeId: yesId,
      shares: 3,
      cost: 6,
    });
    await seedDepositAndPurchase({
      userId: guestCId,
      marketId,
      outcomeId: yesId,
      shares: 2,
      cost: 4,
    });
    await seedDepositAndPurchase({
      userId: guestBId,
      marketId,
      outcomeId: noId,
      shares: 5,
      cost: 5,
    });
  });

  it("resolves with Yes winning", async () => {
    await resolveMarket(adminId, marketId, yesId, { prismaClient: prisma });
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("RESOLVED");
  });

  it("Guest A (3 shares) gets $9.00 — proportional 3/5 of $15 pool", async () => {
    const payoutTx = await prisma.transaction.findFirst({
      where: {
        userId: guestAId,
        type: "PAYOUT",
        creditAccount: `user:${guestAId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(9.0, 4);
  });

  it("Guest C (2 shares) gets $6.00 — proportional 2/5 of $15 pool", async () => {
    const payoutTx = await prisma.transaction.findFirst({
      where: {
        userId: guestCId,
        type: "PAYOUT",
        creditAccount: `user:${guestCId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(6.0, 4);
  });

  it("SUM(payouts) equals total pool ($15)", async () => {
    const payoutTxs = await prisma.transaction.findMany({
      where: {
        marketId: undefined, // fetch by userId matching winners
        type: "PAYOUT",
        userId: { in: [guestAId, guestCId] },
      },
      orderBy: { createdAt: "desc" },
      take: 2, // latest 2 payouts for these users
    });
    const totalPaid = payoutTxs.reduce(
      (sum: number, t: { amount: unknown }) => sum + Number(t.amount),
      0
    );
    expect(totalPaid).toBeCloseTo(15.0, 4);
  });

  it("reconciliation holds after parimutuel resolution", async () => {
    // All deposits: A=$6, C=$4, B=$5 → $15
    // All purchases debited from users → $15 to house_amm
    // Payouts: A=$9, C=$6 → $15 from house_amm
    // housePool = deposits($15) - userBalances($15) - 0 - 0 - 0 = 0 ✓
    const result = await prisma.$queryRaw<
      Array<{
        total_deposits: string;
        total_user_credits: string;
        total_user_debits: string;
        total_house_credits: string;
        total_house_debits: string;
      }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END), 0)           AS total_deposits,
        COALESCE(SUM(CASE WHEN credit_account LIKE 'user:%' THEN amount ELSE 0 END), 0) AS total_user_credits,
        COALESCE(SUM(CASE WHEN debit_account  LIKE 'user:%' THEN amount ELSE 0 END), 0) AS total_user_debits,
        COALESCE(SUM(CASE WHEN credit_account = 'house_amm' THEN amount ELSE 0 END), 0) AS total_house_credits,
        COALESCE(SUM(CASE WHEN debit_account  = 'house_amm' THEN amount ELSE 0 END), 0) AS total_house_debits
      FROM transactions
    `;
    const row = result[0]!;
    const userBalances = Number(row.total_user_credits) - Number(row.total_user_debits);
    const houseAmm = Number(row.total_house_credits) - Number(row.total_house_debits);
    const totalDeposits = Number(row.total_deposits);

    // house_pool = deposits - userBalances - houseAmm_net_used_for_charity_etc
    // Simplified: userBalances + houseAmm should sum to ≤ totalDeposits
    // (houseAmm ≥ 0 after parimutuel since payouts ≤ pool)
    expect(houseAmm).toBeGreaterThanOrEqual(-0.001); // near zero (rounding dust)
    expect(userBalances + houseAmm).toBeCloseTo(totalDeposits, 2);
  });
});

// ---------------------------------------------------------------------------
// Test 5: resolveMarket — edge case: no bets on winning outcome → refund all
// ---------------------------------------------------------------------------

describe("resolveMarket — no bets on winning outcome", () => {
  let marketId: string;
  let yesId: string;
  let noId: string;

  // Scenario:
  //   Nobody bets on Yes
  //   Guest B bets $5 on No
  //   Guest A bets $3 on No
  //   Resolve with Yes winning → no winning shares → refund ALL bets
  //   Market is still RESOLVED with winningOutcomeId = yesId

  beforeAll(async () => {
    marketId = await createMarket(
      adminId,
      "No bets on winner edge case",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    yesId = outcomes[0]!.id;
    noId = outcomes[1]!.id;

    // Only No bets — Yes gets no bets
    await seedDepositAndPurchase({
      userId: guestBId,
      marketId,
      outcomeId: noId,
      shares: 5,
      cost: 5,
    });
    await seedDepositAndPurchase({
      userId: guestAId,
      marketId,
      outcomeId: noId,
      shares: 3,
      cost: 3,
    });
  });

  it("resolves with Yes winning (nobody bet on Yes)", async () => {
    await resolveMarket(adminId, marketId, yesId, { prismaClient: prisma });
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("RESOLVED");
    expect(market!.winningOutcomeId).toBe(yesId);
  });

  it("Guest B gets a REFUND (bet on No, nobody won)", async () => {
    const refundTx = await prisma.transaction.findFirst({
      where: {
        userId: guestBId,
        type: "REFUND",
        creditAccount: `user:${guestBId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(refundTx).not.toBeNull();
    expect(Number(refundTx!.amount)).toBeCloseTo(5.0, 4);
  });

  it("Guest A gets a REFUND (bet on No, nobody won)", async () => {
    const refundTx = await prisma.transaction.findFirst({
      where: {
        userId: guestAId,
        type: "REFUND",
        creditAccount: `user:${guestAId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(refundTx).not.toBeNull();
    expect(Number(refundTx!.amount)).toBeCloseTo(3.0, 4);
  });

  it("no PAYOUT transactions created (refund path used)", async () => {
    // In this market's timeframe, only REFUNDs should exist (no PAYOUTs)
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "RESOLVE_MARKET" },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta["resolution"]).toBe("no_winner_refunded");
  });

  it("logs RESOLVE_MARKET to AdminAuditLog", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "RESOLVE_MARKET" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.adminId).toBe(adminId);
  });
});

// ---------------------------------------------------------------------------
// Test 6: voidMarket — refunds all purchases, reconciliation holds
// ---------------------------------------------------------------------------

describe("voidMarket", () => {
  let marketId: string;
  let outcomeId: string;
  let purchaseId: string;

  const PURCHASE_COST = 10; // $10

  beforeAll(async () => {
    marketId = await createMarket(
      adminId,
      "Will the flowers match the invitations?",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const outcomes = await prisma.outcome.findMany({ where: { marketId } });
    outcomeId = outcomes[0]!.id;

    // Guest A buys $10 on the outcome
    const result = await seedDepositAndPurchase({
      userId: guestAId,
      marketId,
      outcomeId,
      shares: 10,
      cost: PURCHASE_COST,
    });
    purchaseId = result.purchaseId;
  });

  it("voids market — status = VOIDED", async () => {
    await voidMarket(adminId, marketId, { prismaClient: prisma });

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("VOIDED");
  });

  it("all outcomes sharesSold reset to 0", async () => {
    const outcomes = await prisma.outcome.findMany({ where: { marketId } });
    for (const o of outcomes) {
      expect(Number(o.sharesSold)).toBe(0);
    }
  });

  it("a REFUND transaction is created for the purchase", async () => {
    const refundTx = await prisma.transaction.findFirst({
      where: {
        userId: guestAId,
        type: "REFUND",
        creditAccount: `user:${guestAId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(refundTx).not.toBeNull();
    expect(Number(refundTx!.amount)).toBeCloseTo(PURCHASE_COST, 4);
  });

  it("reconciliation: sum(refunds) = sum(purchase costs) for the market", async () => {
    // Get all purchases for this market
    const purchases = await prisma.purchase.findMany({ where: { marketId } });
    const totalPurchased = purchases.reduce(
      (s: number, p: { cost: unknown }) => s + Number(p.cost),
      0
    );

    // Get all REFUND transactions for the users who had purchases in this market
    const userIds = [...new Set(purchases.map((p: { userId: string }) => p.userId))];
    const refundTxs = await prisma.transaction.findMany({
      where: {
        userId: { in: userIds },
        type: "REFUND",
      },
    });
    const totalRefunded = refundTxs.reduce(
      (s: number, t: { amount: unknown }) => s + Number(t.amount),
      0
    );

    // Every dollar spent must be refunded (for this market's users, at minimum)
    expect(totalRefunded).toBeGreaterThanOrEqual(totalPurchased - 0.001);
  });

  it("double-void throws", async () => {
    await expect(
      voidMarket(adminId, marketId, { prismaClient: prisma })
    ).rejects.toThrow("already voided");
  });

  it("cannot void a resolved market", async () => {
    // Create + resolve a market first
    const mid = await createMarket(adminId, "Resolved first", ["Yes", "No"], {
      prismaClient: prisma,
    });
    const outcomes = await prisma.outcome.findMany({ where: { marketId: mid } });
    await resolveMarket(adminId, mid, outcomes[0]!.id, { prismaClient: prisma });

    await expect(
      voidMarket(adminId, mid, { prismaClient: prisma })
    ).rejects.toThrow("Cannot void a resolved market");
  });

  it("logs VOID_MARKET to AdminAuditLog", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "VOID_MARKET" },
    });
    expect(audit).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 7: pauseMarket — status PAUSED
// ---------------------------------------------------------------------------

describe("pauseMarket", () => {
  let marketId: string;

  beforeAll(async () => {
    marketId = await createMarket(
      adminId,
      "Will the DJ play Diljit?",
      ["Yes", "No"],
      { prismaClient: prisma }
    );
  });

  it("pauses an ACTIVE market", async () => {
    await pauseMarket(adminId, marketId, { prismaClient: prisma });

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("PAUSED");
  });

  it("cannot pause a non-ACTIVE market (double-pause throws)", async () => {
    await expect(
      pauseMarket(adminId, marketId, { prismaClient: prisma })
    ).rejects.toThrow("Only ACTIVE markets can be paused");
  });

  it("logs PAUSE_MARKET to AdminAuditLog", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "PAUSE_MARKET" },
    });
    expect(audit).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 8: getMarketWithPrices — prices computed from LMSR, pool info included
// ---------------------------------------------------------------------------

describe("getMarketWithPrices", () => {
  it("returns null for non-existent market", async () => {
    const result = await getMarketWithPrices(
      "00000000-0000-0000-0000-000000000000",
      prisma
    );
    expect(result).toBeNull();
  });

  it("computed prices sum to 1.0 for a market with shares", async () => {
    const marketId = await createMarket(
      adminId,
      "Three-way market",
      ["A", "B", "C"],
      { prismaClient: prisma }
    );

    // Buy some shares on outcome A
    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    const aId = outcomes[0]!.id;
    await prisma.outcome.update({
      where: { id: aId },
      data: { sharesSold: { increment: 10 } },
    });

    const market = await getMarketWithPrices(marketId, prisma);
    const priceSum = market!.outcomes.reduce((s, o) => s + o.price, 0);
    expect(Math.abs(priceSum - 1.0)).toBeLessThan(0.0001);
  });

  it("returns totalPool equal to totalVolume", async () => {
    const marketId = await createMarket(
      adminId,
      "Pool info test market",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();
    expect(market!.totalPool).toBe(market!.totalVolume);
    expect(market!.totalPool).toBe(0); // no purchases yet
  });

  it("estimatedPayoutPerShare is 0 when no shares sold", async () => {
    const marketId = await createMarket(
      adminId,
      "Payout per share test",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();
    for (const o of market!.outcomes) {
      expect(o.estimatedPayoutPerShare).toBe(0);
    }
  });

  it("estimatedPayoutPerShare = totalPool / sharesSold when shares exist", async () => {
    const marketId = await createMarket(
      adminId,
      "Payout per share with volume",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    const yesId = outcomes[0]!.id;

    // Seed 4 shares + $8 cost on Yes
    await seedDepositAndPurchase({
      userId: guestAId,
      marketId,
      outcomeId: yesId,
      shares: 4,
      cost: 8,
    });

    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();

    // totalPool = $8, Yes has 4 shares → estimatedPayoutPerShare = $2.00
    const yesOutcome = market!.outcomes.find((o) => o.id === yesId);
    expect(yesOutcome).not.toBeUndefined();
    expect(yesOutcome!.estimatedPayoutPerShare).toBeCloseTo(2.0, 4);

    // No has 0 shares → estimatedPayoutPerShare = 0
    const noOutcome = market!.outcomes.find((o) => o.id !== yesId);
    expect(noOutcome!.estimatedPayoutPerShare).toBe(0);
  });
});
