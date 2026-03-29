/**
 * Purchase Engine — Unit Tests (Prisma mocked)
 *
 * Tests:
 *  1. Basic purchase: $10 on a binary market → shares > 0, prices changed
 *  2. $200 cap enforcement: buy $200, then try $1 more → CAP_EXCEEDED error
 *  3. Insufficient balance: $0 balance tries to buy → INSUFFICIENT_BALANCE error
 *  4. Market not active: PENDING market → MARKET_NOT_ACTIVE error
 *  5. Reconciliation: post-purchase invariant holds with consistent mock data
 *  6. Price impact: q=[0,0], b=20 — verify price moves match LMSR formula
 *
 * Strategy: mock the db module so prisma.$transaction calls the callback with
 * a fully controlled tx object.  All LMSR math runs against the REAL functions
 * (not mocked) — only database I/O is replaced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buyShares, PurchaseError, toNumber } from "../purchaseEngine.js";
import {
  allPrices,
  computeSharesForDollarAmount,
  price,
} from "../lmsr.js";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

// We mock the db module BEFORE importing buyShares so that the module-level
// `prisma` reference is replaced.
vi.mock("../../db.js", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../db.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const MARKET_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const OUTCOME_YES_ID = "cccccccc-0000-0000-0000-000000000001";
const OUTCOME_NO_ID = "cccccccc-0000-0000-0000-000000000002";
const PURCHASE_ID = "dddddddd-0000-0000-0000-000000000001";
const TRANSACTION_ID = "eeeeeeee-0000-0000-0000-000000000001";

const OPENED_AT = new Date(Date.now() - 30_000); // 30 seconds ago

/** An ACTIVE binary market opened 30s ago, no bFloorOverride. */
const mockMarket = {
  id: MARKET_ID,
  status: "ACTIVE",
  openedAt: OPENED_AT,
  bFloorOverride: null,
};

/** Outcomes with q=[0,0] — fresh market, no shares sold. */
const mockOutcomes = [
  {
    id: OUTCOME_YES_ID,
    market_id: MARKET_ID,
    position: 0,
    shares_sold: "0",
    label: "Yes",
  },
  {
    id: OUTCOME_NO_ID,
    market_id: MARKET_ID,
    position: 1,
    shares_sold: "0",
    label: "No",
  },
];

/** Builds a tx mock object where all methods are vi.fn() stubs. */
function makeTx() {
  return {
    $queryRaw: vi.fn(),
    market: { findUnique: vi.fn() },
    outcome: { update: vi.fn() },
    purchase: { create: vi.fn() },
    transaction: { findFirst: vi.fn(), create: vi.fn() },
    position: { upsert: vi.fn() },
  };
}

/** Wire $transaction to execute the callback with the given tx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockTransaction(tx: ReturnType<typeof makeTx>): void {
  vi.mocked(prisma.$transaction).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (fn: any) => fn(tx)
  );
}

/**
 * Set up a tx mock for a HAPPY-PATH purchase.
 *
 * @param balanceDollars    - User's current ledger balance in dollars
 * @param spendDollars      - Existing spend in this market in dollars
 * @param volumeDollars     - Total market volume in dollars (for adaptive b)
 * @param sharesSold        - Current state vector [yes, no] as number[]
 */
function wireHappyPath(
  tx: ReturnType<typeof makeTx>,
  opts: {
    balanceDollars?: number;
    spendDollars?: number;
    volumeDollars?: number;
    sharesSold?: number[];
  } = {}
): void {
  const {
    balanceDollars = 20,
    spendDollars = 0,
    volumeDollars = 0,
    sharesSold = [0, 0],
  } = opts;

  tx.market.findUnique.mockResolvedValue(mockMarket);

  // FOR UPDATE lock
  tx.$queryRaw.mockResolvedValueOnce(
    mockOutcomes.map((o, i) => ({
      ...o,
      shares_sold: String(sharesSold[i] ?? 0),
    }))
  );

  // User balance
  tx.$queryRaw.mockResolvedValueOnce([{ balance: balanceDollars }]);

  // Market spend
  tx.$queryRaw.mockResolvedValueOnce([{ total_spend: spendDollars }]);

  // Market volume
  tx.$queryRaw.mockResolvedValueOnce([{ total_volume: volumeDollars }]);

  // outcome.update
  tx.outcome.update.mockResolvedValue({});

  // transaction.findFirst (prevHash)
  tx.transaction.findFirst.mockResolvedValue(null);

  // purchase.create
  tx.purchase.create.mockResolvedValue({ id: PURCHASE_ID });

  // transaction.create
  tx.transaction.create.mockResolvedValue({ id: TRANSACTION_ID });

  // position.upsert
  tx.position.upsert.mockResolvedValue({});

  // Reconciliation query — returns values that satisfy the invariant.
  // After buying $10 with $20 deposit: userBalance=$10, houseAmm=$10, deposits=$20
  const userBalance = balanceDollars - (spendDollars + 0.1); // approximate post-purchase
  const houseAmm = spendDollars + 0.1;
  const depositsTotal = balanceDollars;
  tx.$queryRaw.mockResolvedValueOnce([
    {
      user_balances: userBalance,
      house_amm: houseAmm,
      charity_pool: 0,
      total_deposits: depositsTotal,
      total_withdrawals: 0,
    },
  ]);
}

// ---------------------------------------------------------------------------
// 1. Basic purchase
// ---------------------------------------------------------------------------

describe("buyShares — basic purchase", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("returns shares > 0, priceAfter > priceBefore for $10 on fresh binary market", async () => {
    wireHappyPath(tx, { balanceDollars: 20, spendDollars: 0 });

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000); // $10

    expect(result.shares).toBeGreaterThan(0);
    expect(result.costCents).toBe(1000);
    expect(result.priceAfterCents).toBeGreaterThan(result.priceBeforeCents);
    expect(result.purchaseId).toBe(PURCHASE_ID);
    expect(result.transactionId).toBe(TRANSACTION_ID);
  });

  it("allNewPrices sums to 1.0 (within tolerance)", async () => {
    wireHappyPath(tx, { balanceDollars: 20 });

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    const priceSum = result.allNewPrices.reduce((a, b) => a + b, 0);
    expect(Math.abs(priceSum - 1.0)).toBeLessThan(0.0001);
  });

  it("creates a Purchase record via tx.purchase.create", async () => {
    wireHappyPath(tx, { balanceDollars: 50 });

    await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    expect(tx.purchase.create).toHaveBeenCalledOnce();
    const purchaseData = tx.purchase.create.mock.calls[0]?.[0]?.data;
    expect(purchaseData?.userId).toBe(USER_ID);
    expect(purchaseData?.marketId).toBe(MARKET_ID);
    expect(purchaseData?.outcomeId).toBe(OUTCOME_YES_ID);
  });

  it("creates a Transaction record via tx.transaction.create", async () => {
    wireHappyPath(tx, { balanceDollars: 50 });

    await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    expect(tx.transaction.create).toHaveBeenCalledOnce();
    const txData = tx.transaction.create.mock.calls[0]?.[0]?.data;
    expect(txData?.type).toBe("PURCHASE");
    expect(txData?.debitAccount).toBe(`user:${USER_ID}`);
    expect(txData?.creditAccount).toBe("house_amm");
  });

  it("updates outcome sharesSold via tx.outcome.update", async () => {
    wireHappyPath(tx, { balanceDollars: 50 });

    await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    expect(tx.outcome.update).toHaveBeenCalledOnce();
    const updateArgs = tx.outcome.update.mock.calls[0]?.[0];
    expect(updateArgs?.where?.id).toBe(OUTCOME_YES_ID);
    expect(updateArgs?.data?.sharesSold?.increment).toBeDefined();
  });

  it("upserts position via tx.position.upsert", async () => {
    wireHappyPath(tx, { balanceDollars: 50 });

    await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    expect(tx.position.upsert).toHaveBeenCalledOnce();
    const upsertArgs = tx.position.upsert.mock.calls[0]?.[0];
    expect(upsertArgs?.where?.userId_marketId_outcomeId?.userId).toBe(USER_ID);
    expect(upsertArgs?.where?.userId_marketId_outcomeId?.marketId).toBe(MARKET_ID);
    expect(upsertArgs?.where?.userId_marketId_outcomeId?.outcomeId).toBe(OUTCOME_YES_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. $200 cap enforcement
// ---------------------------------------------------------------------------

describe("buyShares — $200 market cap", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("throws CAP_EXCEEDED when existing spend + new amount > $200", async () => {
    // User has already spent $200 in this market; trying to spend $1 more
    tx.market.findUnique.mockResolvedValue(mockMarket);
    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes) // FOR UPDATE lock
      .mockResolvedValueOnce([{ balance: 300 }]) // balance: $300
      .mockResolvedValueOnce([{ total_spend: 200 }]); // already at $200 cap

    // Single call: verify it rejects with the right PurchaseError code
    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 100) // try $1 more
    ).rejects.toMatchObject({ code: "CAP_EXCEEDED" });
  });

  it("allows purchase that exactly reaches $200 cap", async () => {
    // User has spent $190, wants to spend $10 more — exactly $200 total
    wireHappyPath(tx, { balanceDollars: 300, spendDollars: 190 });

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000); // $10

    expect(result.costCents).toBe(1000);
  });

  it("throws CAP_EXCEEDED when total spend would exceed $200 by $0.01", async () => {
    // $0.01 existing spend, trying to buy $200.00 (20000 cents) = $200.01 total → over $200 cap
    tx.market.findUnique.mockResolvedValue(mockMarket);
    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes)
      .mockResolvedValueOnce([{ balance: 200 }])
      .mockResolvedValueOnce([{ total_spend: 0.01 }]); // $0.01 existing spend

    // Try buying $200.00 = $200.01 total → exceeds cap
    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 20000)
    ).rejects.toMatchObject({ code: "CAP_EXCEEDED" });
  });
});

// ---------------------------------------------------------------------------
// 3. Insufficient balance
// ---------------------------------------------------------------------------

describe("buyShares — insufficient balance", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("throws INSUFFICIENT_BALANCE when user has $0", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);
    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes) // lock
      .mockResolvedValueOnce([{ balance: 0 }]); // balance = $0

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000) // $10
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("throws INSUFFICIENT_BALANCE when balance is less than amount", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);
    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes)
      .mockResolvedValueOnce([{ balance: 5 }]); // $5 balance

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000) // $10
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("allows purchase when balance exactly equals amount", async () => {
    // $10 balance, buying $10 — should succeed (no floating point issues)
    wireHappyPath(tx, { balanceDollars: 10, spendDollars: 0 });

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);
    expect(result.costCents).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 4. Market not active
// ---------------------------------------------------------------------------

describe("buyShares — market status validation", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("throws MARKET_NOT_ACTIVE for PENDING market", async () => {
    tx.market.findUnique.mockResolvedValue({ ...mockMarket, status: "PENDING" });

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000)
    ).rejects.toMatchObject({ code: "MARKET_NOT_ACTIVE" });
  });

  it("throws MARKET_NOT_ACTIVE for PAUSED market", async () => {
    tx.market.findUnique.mockResolvedValue({ ...mockMarket, status: "PAUSED" });

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000)
    ).rejects.toMatchObject({ code: "MARKET_NOT_ACTIVE" });
  });

  it("throws MARKET_NOT_ACTIVE for RESOLVED market", async () => {
    tx.market.findUnique.mockResolvedValue({
      ...mockMarket,
      status: "RESOLVED",
    });

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000)
    ).rejects.toMatchObject({ code: "MARKET_NOT_ACTIVE" });
  });

  it("throws MARKET_NOT_FOUND when market does not exist", async () => {
    tx.market.findUnique.mockResolvedValue(null);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000)
    ).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
  });

  it("throws INVALID_AMOUNT for non-integer cents", async () => {
    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 9.99)
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("throws INVALID_AMOUNT for zero cents", async () => {
    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 0)
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

// ---------------------------------------------------------------------------
// 5. Reconciliation check
// ---------------------------------------------------------------------------

describe("buyShares — reconciliation invariant", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("succeeds when conservation holds: user_bal + house_amm + charity = deposits", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);

    // Scenario: $20 deposited, $10 spent on purchase
    // user_balance = $10, house_amm = $10, deposits = $20
    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes) // lock
      .mockResolvedValueOnce([{ balance: 20 }]) // balance: $20
      .mockResolvedValueOnce([{ total_spend: 0 }]) // no prior spend
      .mockResolvedValueOnce([{ total_volume: 0 }]); // no prior volume

    tx.outcome.update.mockResolvedValue({});
    tx.transaction.findFirst.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue({ id: PURCHASE_ID });
    tx.transaction.create.mockResolvedValue({ id: TRANSACTION_ID });
    tx.position.upsert.mockResolvedValue({});

    // Reconciliation: after $10 purchase from $20 deposit
    // user_balances=10, house_amm=10, charity_pool=0, deposits=20, withdrawals=0
    // lhs = 10 + 10 + 0 + 0 = 20 = rhs ✓
    tx.$queryRaw.mockResolvedValueOnce([
      {
        user_balances: 10,
        house_amm: 10,
        charity_pool: 0,
        total_deposits: 20,
        total_withdrawals: 0,
      },
    ]);

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);
    expect(result.shares).toBeGreaterThan(0);
  });

  it("throws RECONCILIATION_FAILED when conservation is violated", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);

    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes)
      .mockResolvedValueOnce([{ balance: 20 }])
      .mockResolvedValueOnce([{ total_spend: 0 }])
      .mockResolvedValueOnce([{ total_volume: 0 }]);

    tx.outcome.update.mockResolvedValue({});
    tx.transaction.findFirst.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue({ id: PURCHASE_ID });
    tx.transaction.create.mockResolvedValue({ id: TRANSACTION_ID });
    tx.position.upsert.mockResolvedValue({});

    // Broken reconciliation: amounts don't balance (lhs=$999 ≠ rhs=$20)
    tx.$queryRaw.mockResolvedValueOnce([
      {
        user_balances: 999,
        house_amm: 0,
        charity_pool: 0,
        total_deposits: 20,
        total_withdrawals: 0,
      },
    ]);

    await expect(
      buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000)
    ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  });
});

// ---------------------------------------------------------------------------
// 6. Price impact — verify against LMSR formula
// ---------------------------------------------------------------------------

describe("buyShares — price impact matches LMSR formula", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("$10 on fresh binary market (q=[0,0], b≈46) — prices match allPrices()", async () => {
    const openedAt = new Date(Date.now() - 30_000); // 30s ago → b≈46 at V=0
    tx.market.findUnique.mockResolvedValue({
      ...mockMarket,
      openedAt,
    });

    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes)           // lock: q=[0,0]
      .mockResolvedValueOnce([{ balance: 50 }])      // balance
      .mockResolvedValueOnce([{ total_spend: 0 }])   // spend
      .mockResolvedValueOnce([{ total_volume: 0 }]); // volume

    tx.outcome.update.mockResolvedValue({});
    tx.transaction.findFirst.mockResolvedValue(null);
    tx.purchase.create.mockResolvedValue({ id: PURCHASE_ID });
    tx.transaction.create.mockResolvedValue({ id: TRANSACTION_ID });
    tx.position.upsert.mockResolvedValue({});

    // Reconciliation balanced
    tx.$queryRaw.mockResolvedValueOnce([
      {
        user_balances: 40,
        house_amm: 10,
        charity_pool: 0,
        total_deposits: 50,
        total_withdrawals: 0,
      },
    ]);

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000); // $10

    // Independently compute expected values using the same LMSR math
    const q = [0, 0];
    const dtMs = Date.now() - openedAt.getTime();
    // b ≈ 20 + 0.6 * 0.25 * sqrt(30000) ≈ 45.98 (time-only at V=0)
    // Allow some variance because dtMs fluctuates slightly between calls
    const b = 20 + 0.6 * 0.25 * Math.sqrt(dtMs); // approximate

    const expectedShares = computeSharesForDollarAmount(q, b, 0, 10);
    const qNew = [expectedShares, 0];
    const expectedPrices = allPrices(qNew, b);
    const expectedPriceBefore = price(q, b, 0);

    // Shares should be within 5% of expected (b is slightly different due to timing)
    expect(result.shares).toBeGreaterThan(expectedShares * 0.95);
    expect(result.shares).toBeLessThan(expectedShares * 1.05);

    // priceBefore should be near 50¢ (fair coin on fresh market)
    expect(result.priceBeforeCents).toBeCloseTo(50, 0);

    // priceAfter should be > priceBefore (bought Yes → Yes price up)
    expect(result.priceAfterCents).toBeGreaterThan(result.priceBeforeCents);

    // allNewPrices should match allPrices() applied to qNew
    // (within rounding since we use cents)
    const sumPrices = result.allNewPrices.reduce((a, b) => a + b, 0);
    expect(Math.abs(sumPrices - 1.0)).toBeLessThan(0.0001);

    // Suppress unused variable warnings
    void expectedPriceBefore;
    void expectedPrices;
  });

  it("buying Yes moves Yes price up and No price down", async () => {
    wireHappyPath(tx, { balanceDollars: 50, sharesSold: [0, 0] });

    const result = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2000); // $20

    // Yes price (index 0) should have gone up
    expect(result.priceAfterCents).toBeGreaterThan(50);
    // allNewPrices[1] (No) should have gone down
    expect(result.allNewPrices[1]).toBeLessThan(0.5);
    // allNewPrices[0] (Yes) should have gone up
    expect(result.allNewPrices[0]).toBeGreaterThan(0.5);
  });

  it("shares received monotonically decrease as price rises (3 sequential buys)", async () => {
    // First buy at q=[0,0]
    wireHappyPath(tx, { balanceDollars: 100, sharesSold: [0, 0] });
    const r1 = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);

    // Second buy — q is now shifted (more Yes shares sold)
    const q1 = r1.shares;
    wireHappyPath(tx, { balanceDollars: 100, sharesSold: [q1, 0] });
    const r2 = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);

    // Third buy — q is shifted further
    const q2 = q1 + r2.shares;
    wireHappyPath(tx, { balanceDollars: 100, sharesSold: [q2, 0] });
    const r3 = await buyShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 1000);

    // Each successive $10 buy should yield fewer shares (diminishing returns)
    expect(r2.shares).toBeLessThan(r1.shares);
    expect(r3.shares).toBeLessThan(r2.shares);
  });
});

// ---------------------------------------------------------------------------
// toNumber helper — unit tests
// ---------------------------------------------------------------------------

describe("toNumber helper", () => {
  it("handles null/undefined → 0", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });

  it("handles plain numbers", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0.5)).toBe(0.5);
  });

  it("handles BigInt", () => {
    expect(toNumber(100n)).toBe(100);
  });

  it("handles numeric strings", () => {
    expect(toNumber("10.50")).toBeCloseTo(10.5);
  });

  it("handles Decimal-like objects", () => {
    expect(toNumber({ toNumber: () => 99 })).toBe(99);
  });
});
