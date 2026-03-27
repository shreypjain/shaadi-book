/**
 * Purchase Engine — Unit Tests
 *
 * All Prisma interactions are mocked so these tests run without a database.
 *
 * Covered paths:
 *  1. Basic purchase — happy path; shares, prices, and balance are correct.
 *  2. Inactive market — rejected before the transaction starts.
 *  3. Insufficient balance — rejected in pre-flight validation.
 *  4. $50 per-market cap — rejected when accumulated spend would exceed $50.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Mock the Prisma singleton BEFORE importing the module under test.
// vi.mock hoists the factory to the top of the file automatically.
// ---------------------------------------------------------------------------

// We build a rich mock tx (transaction sub-client) that the $transaction
// callback receives.  Each test can override individual methods.

const mockTx = {
  $queryRaw: vi.fn(),
  outcome: { update: vi.fn() },
  purchase: {
    aggregate: vi.fn(),
    create: vi.fn(),
  },
  transaction: {
    findFirst: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
  },
  position: { upsert: vi.fn() },
};

vi.mock("../../db.js", () => ({
  prisma: {
    market: { findUnique: vi.fn() },
    transaction: { aggregate: vi.fn() },
    purchase: { aggregate: vi.fn() },
    // $transaction calls the callback immediately with mockTx
    $transaction: vi.fn(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)
    ),
  },
}));

// Import after mock is registered
import { buyShares } from "../purchaseEngine.js";
import { prisma } from "../../db.js";

// ---------------------------------------------------------------------------
// Test IDs
// ---------------------------------------------------------------------------

const USER_ID = "user-aaa-111";
const MARKET_ID = "market-bbb-222";
const OUTCOME_YES = "outcome-yes-333";
const OUTCOME_NO = "outcome-no-444";
const PURCHASE_ID = "purchase-ccc-555";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Returns a Prisma Decimal-like object for a given numeric value. */
function decimal(n: number) {
  return { toNumber: () => n };
}

/** Default active market fixture. */
function activeMarket() {
  return {
    status: "ACTIVE" as const,
    openedAt: new Date(Date.now() - 60_000), // opened 60 s ago
    bFloorOverride: null,
  };
}

/**
 * Set up the standard happy-path mocks.
 *
 * Balance:  $100 (two transactions: $110 credit, $10 debit)
 * Spend:    $0 previous spend on this market
 * Outcomes: [Yes=0 shares, No=0 shares] — 50/50 starting point
 */
function setupHappyPath() {
  const { prisma: p } = vi.mocked({ prisma } as { prisma: typeof prisma });

  // --- Pre-flight mocks (use prisma directly) ---
  vi.mocked(p.market.findUnique).mockResolvedValue(activeMarket() as never);

  // getUserBalance (pre-flight): credits $110, debits $10 → $100
  vi.mocked(p.transaction.aggregate)
    .mockResolvedValueOnce({ _sum: { amount: decimal(110) } } as never) // credits
    .mockResolvedValueOnce({ _sum: { amount: decimal(10) } } as never); // debits

  // getUserMarketSpend (pre-flight): $0 previous spend
  vi.mocked(p.purchase.aggregate).mockResolvedValueOnce({
    _sum: { cost: null },
  } as never);

  // --- Transaction sub-client mocks ---

  // Lock user row (SELECT … FOR UPDATE)
  mockTx.$queryRaw.mockResolvedValueOnce([{ id: USER_ID }]);

  // Lock outcome rows (SELECT … FOR UPDATE)
  mockTx.$queryRaw.mockResolvedValueOnce([
    { id: OUTCOME_YES, label: "Yes", position: 0, shares_sold: "0" },
    { id: OUTCOME_NO, label: "No", position: 1, shares_sold: "0" },
  ]);

  // getUserBalance (in-tx re-check): same $100 balance
  mockTx.transaction.aggregate
    .mockResolvedValueOnce({ _sum: { amount: decimal(110) } } as never) // credits
    .mockResolvedValueOnce({ _sum: { amount: decimal(10) } } as never); // debits

  // getUserMarketSpend (in-tx re-check): $0
  mockTx.purchase.aggregate
    .mockResolvedValueOnce({ _sum: { cost: null } } as never) // market cap re-check
    .mockResolvedValueOnce({ _sum: { cost: null } } as never); // volume for adaptiveB

  // outcome.update — no return value needed
  mockTx.outcome.update.mockResolvedValue({} as never);

  // purchase.create — return a record with a known ID
  mockTx.purchase.create.mockResolvedValue({
    id: PURCHASE_ID,
    userId: USER_ID,
    marketId: MARKET_ID,
    outcomeId: OUTCOME_YES,
    shares: 30,
    cost: 10,
    avgPrice: 0.33,
    priceBefore: 0.5,
    priceAfter: 0.816,
    bAtPurchase: 20,
    createdAt: new Date(),
  } as never);

  // getLastHash (for hash chain)
  mockTx.transaction.findFirst.mockResolvedValue(null);
  // transaction.create — no return value needed
  mockTx.transaction.create.mockResolvedValue({} as never);

  // position.upsert — no return value needed
  mockTx.position.upsert.mockResolvedValue({} as never);

  // getUserBalance (post-insert reconciliation check): $90 ($100 - $10 spent)
  mockTx.transaction.aggregate
    .mockResolvedValueOnce({ _sum: { amount: decimal(110) } } as never)
    .mockResolvedValueOnce({ _sum: { amount: decimal(20) } } as never); // +$10 purchase debit
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buyShares — basic purchase", () => {
  it("returns correct receipt on a valid $10 purchase of Yes", async () => {
    setupHappyPath();

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 1000);

    // purchaseId is whatever purchase.create returned
    expect(result.purchaseId).toBe(PURCHASE_ID);

    // Cost should be $10 (= 1000 cents / 100)
    expect(result.costDollars).toBe(10);

    // Must receive a positive number of shares
    expect(result.shares).toBeGreaterThan(0);

    // New balance should be $90 (= 9000 cents)
    expect(result.newBalanceCents).toBe(9000);

    // Prices: two outcomes, both in (0, 1), summing to ~1
    expect(result.newPrices).toHaveLength(2);
    const priceSum = result.newPrices.reduce((s, p) => s + p.priceDollars, 0);
    expect(Math.abs(priceSum - 1)).toBeLessThan(0.0001);

    // After buying Yes, its price should be above 0.5
    const yesPrice = result.newPrices.find((p) => p.outcomeId === OUTCOME_YES);
    expect(yesPrice?.priceDollars).toBeGreaterThan(0.5);

    // Outcome update was called with the higher share count
    expect(mockTx.outcome.update).toHaveBeenCalledOnce();
    expect(mockTx.purchase.create).toHaveBeenCalledOnce();
    expect(mockTx.transaction.create).toHaveBeenCalledOnce();
    expect(mockTx.position.upsert).toHaveBeenCalledOnce();
  });

  it("hash-chain INSERT uses the genesis hash when no prior transaction exists", async () => {
    setupHappyPath();
    await buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 1000);

    const txCreateCall = vi.mocked(mockTx.transaction.create).mock.calls[0]![0];
    expect(txCreateCall?.data?.prevHash).toBe("0".repeat(64));
    expect(typeof txCreateCall?.data?.txHash).toBe("string");
    expect(txCreateCall?.data?.txHash).toHaveLength(64);
  });

  it("transaction row has correct debit/credit accounts", async () => {
    setupHappyPath();
    await buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 1000);

    const txCreateCall = vi.mocked(mockTx.transaction.create).mock.calls[0]![0];
    expect(txCreateCall?.data?.debitAccount).toBe(`user:${USER_ID}`);
    expect(txCreateCall?.data?.creditAccount).toBe("house_amm");
    expect(txCreateCall?.data?.type).toBe("PURCHASE");
    expect(txCreateCall?.data?.amount).toBe(10);
  });
});

describe("buyShares — inactive market", () => {
  it("throws BAD_REQUEST when market status is PENDING", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue({
      status: "PENDING",
      openedAt: null,
      bFloorOverride: null,
    } as never);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 500)
    ).rejects.toThrow(TRPCError);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 500)
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("not active") });
  });

  it("throws BAD_REQUEST when market status is RESOLVED", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue({
      status: "RESOLVED",
      openedAt: new Date(),
      bFloorOverride: null,
    } as never);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 500)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws NOT_FOUND when market does not exist", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue(null);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 500)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("never starts a $transaction for an inactive market", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue({
      status: "PAUSED",
      openedAt: null,
      bFloorOverride: null,
    } as never);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 500)
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("buyShares — insufficient balance", () => {
  it("throws BAD_REQUEST when user balance < purchase amount", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue(activeMarket() as never);

    // Balance: $5.00 (credits $5, debits $0)
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: decimal(5) } } as never)  // credits
      .mockResolvedValueOnce({ _sum: { amount: decimal(0) } } as never); // debits

    vi.mocked(prisma.purchase.aggregate).mockResolvedValue({
      _sum: { cost: null },
    } as never);

    // Try to spend $10 when balance is only $5
    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 1000)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("balance"),
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("throws BAD_REQUEST when balance is exactly zero", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue(activeMarket() as never);

    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: null } } as never)
      .mockResolvedValueOnce({ _sum: { amount: null } } as never);

    vi.mocked(prisma.purchase.aggregate).mockResolvedValue({
      _sum: { cost: null },
    } as never);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 100)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a zero-cent purchase amount", async () => {
    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 0)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prisma.market.findUnique).not.toHaveBeenCalled();
  });
});

describe("buyShares — $50 per-market cap", () => {
  it("throws BAD_REQUEST when accumulated spend + new amount exceeds $50", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue(activeMarket() as never);

    // Balance: $100 (plenty)
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: decimal(100) } } as never)
      .mockResolvedValueOnce({ _sum: { amount: decimal(0) } } as never);

    // Previous spend in this market: $41 → $41 + $10 = $51 > $50
    vi.mocked(prisma.purchase.aggregate).mockResolvedValue({
      _sum: { cost: decimal(41) },
    } as never);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 1000) // $10
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("cap"),
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows a purchase that exactly hits $50 cap", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue(activeMarket() as never);

    // Balance: $100
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: decimal(100) } } as never)
      .mockResolvedValueOnce({ _sum: { amount: decimal(0) } } as never);

    // Previous spend: $40 → $40 + $10 = $50 exactly (allowed)
    vi.mocked(prisma.purchase.aggregate)
      .mockResolvedValueOnce({ _sum: { cost: decimal(40) } } as never);

    // Now set up the tx mocks for the actual execution
    mockTx.$queryRaw
      .mockResolvedValueOnce([{ id: USER_ID }]) // user lock
      .mockResolvedValueOnce([
        { id: OUTCOME_YES, label: "Yes", position: 0, shares_sold: "100" },
        { id: OUTCOME_NO, label: "No", position: 1, shares_sold: "80" },
      ]);

    // In-tx balance: $100
    mockTx.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: decimal(100) } } as never)
      .mockResolvedValueOnce({ _sum: { amount: decimal(0) } } as never);

    // In-tx spend: $40 (cap re-check), volume $40 (for adaptive b)
    mockTx.purchase.aggregate
      .mockResolvedValueOnce({ _sum: { cost: decimal(40) } } as never)
      .mockResolvedValueOnce({ _sum: { cost: decimal(40) } } as never);

    mockTx.outcome.update.mockResolvedValue({} as never);
    mockTx.purchase.create.mockResolvedValue({ id: PURCHASE_ID } as never);
    mockTx.transaction.findFirst.mockResolvedValue(null);
    mockTx.transaction.create.mockResolvedValue({} as never);
    mockTx.position.upsert.mockResolvedValue({} as never);

    // Post-insert reconciliation: $90 balance
    mockTx.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: decimal(100) } } as never)
      .mockResolvedValueOnce({ _sum: { amount: decimal(10) } } as never);

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 1000);
    expect(result.purchaseId).toBe(PURCHASE_ID);
  });

  it("throws BAD_REQUEST for a standalone $50 purchase when any prior spend exists", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue(activeMarket() as never);

    // Balance: $200
    vi.mocked(prisma.transaction.aggregate)
      .mockResolvedValueOnce({ _sum: { amount: decimal(200) } } as never)
      .mockResolvedValueOnce({ _sum: { amount: decimal(0) } } as never);

    // Previous spend: $1 → $1 + $50 = $51 > $50
    vi.mocked(prisma.purchase.aggregate).mockResolvedValue({
      _sum: { cost: decimal(1) },
    } as never);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES, 5000) // $50
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
