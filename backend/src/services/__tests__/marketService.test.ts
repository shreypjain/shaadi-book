/**
 * Market Service Integration Tests — Task 2.2
 *
 * Tests the full market lifecycle against a live PostgreSQL test database.
 * Run with: npm test (from /backend directory)
 *
 * Covered paths:
 *   1. createMarket with 2 outcomes → status ACTIVE, prices at 50%
 *   2. createMarket with scheduledOpenAt → status PENDING, openedAt null
 *   3. resolveMarket → winning positions paid full $1.00 per share
 *   4. voidMarket → all purchases refunded, reconciliation holds
 *   5. pauseMarket → status PAUSED
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
// Test 3: resolveMarket — winners paid full $1.00 per share
// ---------------------------------------------------------------------------

describe("resolveMarket", () => {
  let marketId: string;
  let yesId: string;
  let noId: string;

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

    // Guest A buys 5 shares on Yes (cost = $5, so each share pays $1.00 at resolution)
    await seedDepositAndPurchase({
      userId: guestAId,
      marketId,
      outcomeId: yesId,
      shares: 5,
      cost: 5,
    });

    // Guest B buys 3 shares on No (loses — no payout)
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

  it("Guest A receives full payout ($1.00 per share)", async () => {
    // Guest A has 5 shares → payout = $5.00 (full $1.00 per share, no charity deduction)
    const payoutTx = await prisma.transaction.findFirst({
      where: {
        userId: guestAId,
        type: "PAYOUT",
        creditAccount: `user:${guestAId}`,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(5.0, 4);
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

  it("Guest B (loser) gets no payout transaction", async () => {
    const payoutTx = await prisma.transaction.findFirst({
      where: { userId: guestBId, type: "PAYOUT" },
      orderBy: { createdAt: "desc" },
    });
    // No payout for Guest B because they bet on the losing outcome
    // (Note: there might be a payout from a different market if tests share state,
    //  but we check the specific marketId context via the timing / ordering)
    // More robustly: check no payout credit to user for this market's resolution period
    expect(payoutTx).toBeNull();
  });

  it("double-resolve throws", async () => {
    await expect(
      resolveMarket(adminId, marketId, yesId, { prismaClient: prisma })
    ).rejects.toThrow("already resolved");
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
// Test 4: voidMarket — refunds all purchases, reconciliation holds
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
// Test 5: pauseMarket — status PAUSED
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
// Test 6: getMarketWithPrices — prices computed from LMSR
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
});
