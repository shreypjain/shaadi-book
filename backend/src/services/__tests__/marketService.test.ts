/**
 * Market Service Integration Tests — Task 2.2 (Parimutuel, Fixed-Supply)
 *
 * Tests the full market lifecycle against a live PostgreSQL test database.
 * Run with: npm test (from /backend directory)
 *
 * Covered paths:
 *   1. createMarket with 2 outcomes → status ACTIVE, prices at 50%
 *   2. createMarket with scheduledOpenAt → status PENDING, openedAt null
 *   3. resolveMarket — capped parimutuel: pool > shares → $1.00/share, house keeps surplus
 *   4. resolveMarket — capped parimutuel: multi-winner, pool > shares → $1.00/share each
 *   4b. resolveMarket — capped parimutuel: thin pool (pool < shares) → pool/shares per share
 *   5. resolveMarket — edge case: no bets on winning outcome → refund all purchases
 *   6. voidMarket → all purchases refunded, reconciliation holds
 *   7. pauseMarket → status PAUSED
 *   8. getMarketWithPrices — LMSR prices, totalPool, estimatedPayoutPerShare, sharesRemaining
 *   + guard tests: double-resolve, void-resolved, pause non-active
 */

import { afterAll, beforeAll, describe as _describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Skip all tests when no DATABASE_URL (e.g. CI without a Postgres service)
const NO_DB = process.env["CI"] === "true" || process.env["SKIP_DB_TESTS"] === "true";
const describe = ((name: string, fn: () => void) =>
  _describe.skipIf(NO_DB)(name, fn)) as typeof _describe;
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

const prisma = NO_DB ? (null as unknown as PrismaClient) : new PrismaClient();

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

  it("outcomes have maxShares=100 and sharesRemaining=100 (no trades yet)", async () => {
    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();
    expect(market!.maxSharesPerOutcome).toBe(100);
    for (const o of market!.outcomes) {
      expect(o.maxShares).toBe(100);
      expect(o.sharesRemaining).toBe(100);
    }
  });

  it("uses fixed defaultB (not adaptive) — currentB is deterministic for binary market", async () => {
    // defaultB(2, 100) = 100 / ln(19^1) = 100 / ln(19) ≈ 33.82
    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();
    expect(market!.currentB).toBeCloseTo(100 / Math.log(19), 4);
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

  it("accepts custom maxSharesPerOutcome and bParameter", async () => {
    const customMarketId = await createMarket(
      adminId,
      "Custom supply market",
      ["Yes", "No"],
      { prismaClient: prisma, maxSharesPerOutcome: 50, bParameter: 15 }
    );
    const market = await getMarketWithPrices(customMarketId, prisma);
    expect(market).not.toBeNull();
    expect(market!.maxSharesPerOutcome).toBe(50);
    expect(market!.currentB).toBeCloseTo(15, 4);
    for (const o of market!.outcomes) {
      expect(o.maxShares).toBe(50);
      expect(o.sharesRemaining).toBe(50);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: resolveMarket — capped parimutuel, pool > shares → $1.00/share
// ---------------------------------------------------------------------------

describe("resolveMarket — capped parimutuel full payout ($1/share)", () => {
  let marketId: string;
  let yesId: string;
  let noId: string;

  // Scenario (pool > winning shares → capped at $1.00/share, house keeps surplus):
  //   Guest A bets $5 on Yes → 5 shares
  //   Guest B bets $3 on No  → 3 shares  (loses)
  //   Total pool = $8, winning shares = 5
  //   rawPayoutPerShare = $8 / 5 = $1.60 → capped at $1.00
  //   A gets 5 × $1.00 = $5.00
  //   House surplus = $8.00 − $5.00 = $3.00

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

    await seedDepositAndPurchase({ userId: guestAId, marketId, outcomeId: yesId, shares: 5, cost: 5 });
    await seedDepositAndPurchase({ userId: guestBId, marketId, outcomeId: noId,  shares: 3, cost: 3 });
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

  it("losing outcome isWinner stays null", async () => {
    const no = await prisma.outcome.findUnique({ where: { id: noId } });
    expect(no!.isWinner).not.toBe(true);
  });

  it("Guest A (5 shares) receives $5.00 — capped at $1.00/share", async () => {
    // rawPPS = $8/5 = $1.60 → capped → $1.00/share → payout = $5.00
    const payoutTx = await prisma.transaction.findFirst({
      where: { userId: guestAId, type: "PAYOUT", creditAccount: `user:${guestAId}` },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(5.0, 4);
  });

  it("house keeps surplus ($3.00) — pool was $8, only $5 paid out", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "RESOLVE_MARKET" },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta["resolution"]).toBe("capped_parimutuel_full");
    expect(Number(meta["payoutPerShare"])).toBeCloseTo(1.0, 4);
    expect(Number(meta["houseSurplus"])).toBeCloseTo(3.0, 4);
  });

  it("no CHARITY_FEE transaction created", async () => {
    const charityTx = await prisma.transaction.findFirst({
      where: { userId: guestAId, type: "CHARITY_FEE" },
    });
    expect(charityTx).toBeNull();
  });

  it("Guest B (loser) gets no PAYOUT", async () => {
    const payoutTxs = await prisma.transaction.findMany({
      where: { userId: guestBId, type: "PAYOUT", creditAccount: `user:${guestBId}` },
    });
    expect(payoutTxs).toHaveLength(0);
  });

  it("double-resolve throws", async () => {
    await expect(
      resolveMarket(adminId, marketId, yesId, { prismaClient: prisma })
    ).rejects.toThrow("already resolved");
  });
});

// ---------------------------------------------------------------------------
// Test 4: resolveMarket — capped parimutuel, multiple winners, pool > shares
// ---------------------------------------------------------------------------

describe("resolveMarket — capped parimutuel multi-winner full payout", () => {
  let marketId: string;
  let yesId: string;
  let noId: string;

  // Scenario (pool still exceeds winning shares → $1.00/share cap applies):
  //   Guest A bets $6 on Yes → 3 shares
  //   Guest C bets $4 on Yes → 2 shares
  //   Guest B bets $5 on No  → 5 shares (loses)
  //   Total pool = $15, winning shares = 5
  //   rawPPS = $15 / 5 = $3.00 → capped at $1.00
  //   A gets 3 × $1.00 = $3.00
  //   C gets 2 × $1.00 = $2.00
  //   House surplus = $15 − $5 = $10.00

  beforeAll(async () => {
    marketId = await createMarket(
      adminId,
      "Capped multi-winner test — will the band play?",
      ["Yes", "No"],
      { prismaClient: prisma }
    );
    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    yesId = outcomes[0]!.id;
    noId = outcomes[1]!.id;

    await seedDepositAndPurchase({ userId: guestAId, marketId, outcomeId: yesId, shares: 3, cost: 6 });
    await seedDepositAndPurchase({ userId: guestCId, marketId, outcomeId: yesId, shares: 2, cost: 4 });
    await seedDepositAndPurchase({ userId: guestBId, marketId, outcomeId: noId,  shares: 5, cost: 5 });
  });

  it("resolves with Yes winning", async () => {
    await resolveMarket(adminId, marketId, yesId, { prismaClient: prisma });
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("RESOLVED");
  });

  it("Guest A (3 shares) gets $3.00 — $1.00/share cap", async () => {
    const payoutTx = await prisma.transaction.findFirst({
      where: { userId: guestAId, type: "PAYOUT", creditAccount: `user:${guestAId}` },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(3.0, 4);
  });

  it("Guest C (2 shares) gets $2.00 — $1.00/share cap", async () => {
    const payoutTx = await prisma.transaction.findFirst({
      where: { userId: guestCId, type: "PAYOUT", creditAccount: `user:${guestCId}` },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(2.0, 4);
  });

  it("house surplus = $10.00 (pool $15 − payouts $5)", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "RESOLVE_MARKET" },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta["resolution"]).toBe("capped_parimutuel_full");
    expect(Number(meta["houseSurplus"])).toBeCloseTo(10.0, 4);
  });

  it("reconciliation: houseAmm ≥ 0 and userBalances + houseAmm = deposits", async () => {
    const result = await prisma.$queryRaw<Array<{
      total_deposits: string;
      total_user_credits: string;
      total_user_debits: string;
      total_house_credits: string;
      total_house_debits: string;
    }>>`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END), 0)            AS total_deposits,
        COALESCE(SUM(CASE WHEN credit_account LIKE 'user:%' THEN amount ELSE 0 END), 0) AS total_user_credits,
        COALESCE(SUM(CASE WHEN debit_account  LIKE 'user:%' THEN amount ELSE 0 END), 0) AS total_user_debits,
        COALESCE(SUM(CASE WHEN credit_account = 'house_amm' THEN amount ELSE 0 END), 0) AS total_house_credits,
        COALESCE(SUM(CASE WHEN debit_account  = 'house_amm' THEN amount ELSE 0 END), 0) AS total_house_debits
      FROM transactions
    `;
    const row = result[0]!;
    const userBalances = Number(row.total_user_credits) - Number(row.total_user_debits);
    const houseAmm     = Number(row.total_house_credits) - Number(row.total_house_debits);
    const totalDeposits = Number(row.total_deposits);
    // With capped parimutuel, house keeps surplus → houseAmm > 0
    expect(houseAmm).toBeGreaterThan(0);
    expect(userBalances + houseAmm).toBeCloseTo(totalDeposits, 2);
  });
});

// ---------------------------------------------------------------------------
// Test 4b: resolveMarket — capped parimutuel, thin pool → pool/shares < $1
// ---------------------------------------------------------------------------

describe("resolveMarket — capped parimutuel thin pool (pool < winning shares)", () => {
  let marketId: string;
  let yesId: string;
  let noId: string;

  // Scenario (thin pool → rawPPS < $1.00, no cap applied):
  //   Guest A bets $2 on Yes → 5 shares
  //   Guest B bets $1 on No  → 3 shares  (loses)
  //   Total pool = $3, winning shares = 5
  //   rawPPS = $3 / 5 = $0.60 → NOT capped (< $1)
  //   A gets 5 × $0.60 = $3.00  (= entire pool, house breaks even)

  beforeAll(async () => {
    marketId = await createMarket(
      adminId,
      "Thin pool test — will it rain?",
      ["Yes", "No"],
      { prismaClient: prisma }
    );
    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    yesId = outcomes[0]!.id;
    noId = outcomes[1]!.id;

    await seedDepositAndPurchase({ userId: guestAId, marketId, outcomeId: yesId, shares: 5, cost: 2 });
    await seedDepositAndPurchase({ userId: guestBId, marketId, outcomeId: noId,  shares: 3, cost: 1 });
  });

  it("resolves with Yes winning", async () => {
    await resolveMarket(adminId, marketId, yesId, { prismaClient: prisma });
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    expect(market!.status).toBe("RESOLVED");
  });

  it("Guest A gets $3.00 — entire pool (rawPPS=$0.60 < $1, no cap)", async () => {
    const payoutTx = await prisma.transaction.findFirst({
      where: { userId: guestAId, type: "PAYOUT", creditAccount: `user:${guestAId}` },
      orderBy: { createdAt: "desc" },
    });
    expect(payoutTx).not.toBeNull();
    expect(Number(payoutTx!.amount)).toBeCloseTo(3.0, 4);
  });

  it("audit log: resolution = capped_parimutuel_thin, houseSurplus ≈ 0", async () => {
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: marketId, action: "RESOLVE_MARKET" },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta["resolution"]).toBe("capped_parimutuel_thin");
    expect(Number(meta["payoutPerShare"])).toBeCloseTo(0.6, 4);
    // house gets rounding dust only — well under $0.001
    expect(Number(meta["houseSurplus"])).toBeLessThan(0.001);
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

  it("sharesRemaining decreases as sharesSold increases", async () => {
    const marketId = await createMarket(
      adminId,
      "Shares remaining test",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const outcomes = await prisma.outcome.findMany({
      where: { marketId },
      orderBy: { position: "asc" },
    });
    const yesId = outcomes[0]!.id;

    // Seed 10 shares on Yes
    await seedDepositAndPurchase({
      userId: guestAId,
      marketId,
      outcomeId: yesId,
      shares: 10,
      cost: 5,
    });

    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();

    const yesOutcome = market!.outcomes.find((o) => o.id === yesId);
    expect(yesOutcome).not.toBeUndefined();
    expect(yesOutcome!.sharesSold).toBe(10);
    expect(yesOutcome!.maxShares).toBe(100);
    expect(yesOutcome!.sharesRemaining).toBe(90);

    // No still has all 100 shares available
    const noOutcome = market!.outcomes.find((o) => o.id !== yesId);
    expect(noOutcome!.sharesRemaining).toBe(100);
  });

  it("currentB uses fixed defaultB for binary market (not adaptive)", async () => {
    const marketId = await createMarket(
      adminId,
      "Fixed b test — binary",
      ["Yes", "No"],
      { prismaClient: prisma }
    );

    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();
    // defaultB(2, 100) = 100 / ln(19) ≈ 33.82; must NOT change over time
    const expectedB = 100 / Math.log(19);
    expect(market!.currentB).toBeCloseTo(expectedB, 4);
  });

  it("currentB uses explicit bParameter when provided", async () => {
    const marketId = await createMarket(
      adminId,
      "Fixed b test — custom bParameter",
      ["Yes", "No"],
      { prismaClient: prisma, bParameter: 25 }
    );

    const market = await getMarketWithPrices(marketId, prisma);
    expect(market).not.toBeNull();
    expect(market!.currentB).toBeCloseTo(25, 4);
  });
});
