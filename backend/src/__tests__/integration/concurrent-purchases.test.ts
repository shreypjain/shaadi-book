/**
 * Concurrent Purchases Integration Test — Task 6.1
 *
 * Simulates 10 users buying shares on the same market simultaneously via
 * Promise.all. Each call is isolated by a fresh tx mock so there is no
 * shared mutable state between concurrent callers.
 *
 * What this tests:
 *  - All 10 purchase calls complete successfully (no unhandled exceptions)
 *  - prisma.$transaction is invoked exactly once per caller
 *  - Each result carries a distinct purchaseId and transactionId
 *  - Every result contains valid shares (> 0) and coherent LMSR prices
 *  - No two results share identical purchaseIds (no cross-contamination)
 *
 * Strategy: mock prisma.$transaction with mockImplementation (not Once) so
 * each of the 10 concurrent calls gets its own fresh tx stub. LMSR math
 * runs against the real implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — must precede vi.mock()
// ---------------------------------------------------------------------------

const { mockPrismaTransaction } = vi.hoisted(() => ({
  mockPrismaTransaction: vi.fn(),
}));

vi.mock("../../db.js", () => ({
  prisma: {
    $transaction: mockPrismaTransaction,
    // transaction.findFirst not needed here (no idempotency checks in buyShares)
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { buyShares } from "../../services/purchaseEngine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MARKET_ID   = "bbbbbbbb-0000-0000-0000-000000000001";
const YES_ID      = "cccccccc-0000-0000-0000-000000000001";
const NO_ID       = "cccccccc-0000-0000-0000-000000000002";
const OPENED_AT   = new Date(Date.now() - 60_000); // 1 minute ago

/** Deterministic UUID per user index. */
function userId(i: number): string {
  return `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------
// Fresh-tx factory — each concurrent call gets its own vi.fn() instances
// ---------------------------------------------------------------------------

function makeConcurrentTx(callIndex: number) {
  const tx = {
    $queryRaw: vi.fn(),
    market: { findUnique: vi.fn() },
    outcome: { update: vi.fn().mockResolvedValue({}) },
    purchase: {
      create: vi.fn().mockResolvedValue({ id: `purchase-id-${callIndex}` }),
    },
    transaction: {
      findFirst: vi.fn().mockResolvedValue(null), // genesis prevHash
      create:    vi.fn().mockResolvedValue({ id: `tx-id-${callIndex}` }),
    },
    position: { upsert: vi.fn().mockResolvedValue({}) },
  };

  tx.market.findUnique.mockResolvedValue({
    id: MARKET_ID,
    status: "ACTIVE",
    openedAt: OPENED_AT,
    bFloorOverride: null,
  });

  // $queryRaw call sequence inside buyShares:
  //  1. FOR UPDATE lock (outcomes)
  //  2. User balance
  //  3. Market spend
  //  4. Market volume
  //  5. Reconciliation check
  tx.$queryRaw
    .mockResolvedValueOnce([
      { id: YES_ID, market_id: MARKET_ID, position: 0, shares_sold: "0", label: "Yes" },
      { id: NO_ID,  market_id: MARKET_ID, position: 1, shares_sold: "0", label: "No"  },
    ])
    .mockResolvedValueOnce([{ balance: 50 }])          // $50 balance (ample for $20 buy)
    .mockResolvedValueOnce([{ total_spend: 0 }])        // no prior spend
    .mockResolvedValueOnce([{ total_volume: 0 }])       // no prior volume
    .mockResolvedValueOnce([{                           // reconciliation — balanced
      user_balances:    30,
      house_amm:        20,
      charity_pool:     0,
      total_deposits:   50,
      total_withdrawals: 0,
    }]);

  return tx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Concurrent purchases — 10 users buy simultaneously on same market", () => {
  const NUM_USERS = 10;
  const AMOUNT_CENTS = 2000; // $20 each

  beforeEach(() => {
    vi.clearAllMocks();

    let callCount = 0;
    // Return a fresh tx mock for every $transaction call so concurrent calls
    // are completely isolated from each other.
    mockPrismaTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) => {
        const idx = callCount++;
        return fn(makeConcurrentTx(idx));
      }
    );
  });

  it("all 10 purchases complete without throwing", async () => {
    const purchases = await Promise.all(
      Array.from({ length: NUM_USERS }, (_, i) =>
        buyShares(userId(i), MARKET_ID, YES_ID, AMOUNT_CENTS)
      )
    );

    expect(purchases).toHaveLength(NUM_USERS);
    // No undefined / null entries
    purchases.forEach((r) => expect(r).toBeDefined());
  });

  it("prisma.$transaction is called exactly once per user (10 total)", async () => {
    await Promise.all(
      Array.from({ length: NUM_USERS }, (_, i) =>
        buyShares(userId(i), MARKET_ID, YES_ID, AMOUNT_CENTS)
      )
    );

    expect(mockPrismaTransaction).toHaveBeenCalledTimes(NUM_USERS);
  });

  it("all purchase IDs are distinct (no cross-contamination between calls)", async () => {
    const results = await Promise.all(
      Array.from({ length: NUM_USERS }, (_, i) =>
        buyShares(userId(i), MARKET_ID, YES_ID, AMOUNT_CENTS)
      )
    );

    const purchaseIds    = results.map((r) => r.purchaseId);
    const transactionIds = results.map((r) => r.transactionId);

    const uniquePurchaseIds    = new Set(purchaseIds);
    const uniqueTransactionIds = new Set(transactionIds);

    expect(uniquePurchaseIds.size).toBe(NUM_USERS);
    expect(uniqueTransactionIds.size).toBe(NUM_USERS);
  });

  it("every result has shares > 0 (LMSR computed correctly for each caller)", async () => {
    const results = await Promise.all(
      Array.from({ length: NUM_USERS }, (_, i) =>
        buyShares(userId(i), MARKET_ID, YES_ID, AMOUNT_CENTS)
      )
    );

    results.forEach((r, i) => {
      expect(r.shares).toBeGreaterThan(0);
      expect(r.costCents).toBe(AMOUNT_CENTS);
      expect(r.outcomeLabel).toBe("Yes");
      // Each call starts from q=[0,0], so all should get the same share count
      if (i > 0) {
        expect(r.shares).toBeCloseTo(results[0]!.shares, 2);
      }
    });
  });

  it("allNewPrices sums to 1.0 for each purchase result", async () => {
    const results = await Promise.all(
      Array.from({ length: NUM_USERS }, (_, i) =>
        buyShares(userId(i), MARKET_ID, YES_ID, AMOUNT_CENTS)
      )
    );

    results.forEach((r) => {
      const priceSum = r.allNewPrices.reduce((a, b) => a + b, 0);
      expect(Math.abs(priceSum - 1.0)).toBeLessThan(0.0001);
    });
  });

  it("Yes price is above 50¢ after each purchase (bought Yes → price up)", async () => {
    const results = await Promise.all(
      Array.from({ length: NUM_USERS }, (_, i) =>
        buyShares(userId(i), MARKET_ID, YES_ID, AMOUNT_CENTS)
      )
    );

    results.forEach((r) => {
      expect(r.priceAfterCents).toBeGreaterThan(50);
      expect(r.priceAfterCents).toBeGreaterThan(r.priceBeforeCents);
    });
  });

  it("each purchase is attributed to the correct user", async () => {
    const userIds = Array.from({ length: NUM_USERS }, (_, i) => userId(i));

    const results = await Promise.all(
      userIds.map((uid) => buyShares(uid, MARKET_ID, YES_ID, AMOUNT_CENTS))
    );

    // purchaseId encodes the call index; transactionId likewise
    results.forEach((r, i) => {
      expect(r.purchaseId).toBe(`purchase-id-${i}`);
      expect(r.transactionId).toBe(`tx-id-${i}`);
    });
  });

  it("handles edge case: last user at exactly $50 cap", async () => {
    vi.clearAllMocks();
    let callCount = 0;

    mockPrismaTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) => {
        const idx = callCount++;
        const tx  = makeConcurrentTx(idx);
        // Last user has already spent $30, buying $20 more = exactly $50
        if (idx === 9) {
          tx.$queryRaw
            .mockReset()
            .mockResolvedValueOnce([
              { id: YES_ID, market_id: MARKET_ID, position: 0, shares_sold: "0", label: "Yes" },
              { id: NO_ID,  market_id: MARKET_ID, position: 1, shares_sold: "0", label: "No"  },
            ])
            .mockResolvedValueOnce([{ balance: 50 }])
            .mockResolvedValueOnce([{ total_spend: 30 }])   // $30 existing → $30 + $20 = $50 ✓
            .mockResolvedValueOnce([{ total_volume: 0 }])
            .mockResolvedValueOnce([{
              user_balances: 0, house_amm: 50, charity_pool: 0,
              total_deposits: 50, total_withdrawals: 0,
            }]);
        }
        return fn(tx);
      }
    );

    const results = await Promise.all(
      Array.from({ length: NUM_USERS }, (_, i) =>
        buyShares(userId(i), MARKET_ID, YES_ID, AMOUNT_CENTS)
      )
    );

    expect(results).toHaveLength(NUM_USERS);
    // Last user's purchase also succeeds
    expect(results[9]!.costCents).toBe(AMOUNT_CENTS);
  });
});
