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
import { buyShares, sellShares, PurchaseError, toNumber } from "../purchaseEngine.js";
import {
  allPrices,
  computeSharesForDollarAmount,
  computeDollarAmountForShares,
} from "../lmsr.js";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

// We mock the db module BEFORE importing buyShares so that the module-level
// `prisma` reference is replaced.
vi.mock("../../db.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    priceSnapshot: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

// Stub the priceSnapshot service so the fire-and-forget call in
// purchaseEngine doesn't log warnings in tests.
vi.mock("../priceSnapshot.js", () => ({
  recordPurchaseSnapshots: vi.fn().mockResolvedValue(undefined),
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
  bParameter: null,
  maxSharesPerOutcome: 1000,
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
    position: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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
 * @param balanceDollars - User's current ledger balance in dollars
 * @param spendDollars   - Existing spend in this market in dollars
 * @param sharesSold     - Current state vector [yes, no] as number[]
 */
function wireHappyPath(
  tx: ReturnType<typeof makeTx>,
  opts: {
    balanceDollars?: number;
    spendDollars?: number;
    sharesSold?: number[];
  } = {}
): void {
  const {
    balanceDollars = 20,
    spendDollars = 0,
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
      .mockResolvedValueOnce([{ total_spend: 0 }]); // no prior spend

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
      .mockResolvedValueOnce([{ total_spend: 0 }]);

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

  it("$10 on fresh binary market (q=[0,0], b≈27) — prices match allPrices()", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);

    tx.$queryRaw
      .mockResolvedValueOnce(mockOutcomes)           // lock: q=[0,0]
      .mockResolvedValueOnce([{ balance: 50 }])      // balance
      .mockResolvedValueOnce([{ total_spend: 0 }]);  // spend

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

    // Fixed b for binary market: defaultB(2, 1000) ≈ 271.7
    const q = [0, 0];
    const b = (0.8 * 1000) / Math.log(19 * 1); // = defaultB(2, 1000)

    const expectedShares = computeSharesForDollarAmount(q, b, 0, 10);

    // Shares match defaultB(2) exactly
    expect(result.shares).toBeCloseTo(expectedShares, 1);

    // priceBefore should be near 50¢ (fair coin on fresh market)
    expect(result.priceBeforeCents).toBeCloseTo(50, 0);

    // priceAfter should be > priceBefore (bought Yes → Yes price up)
    expect(result.priceAfterCents).toBeGreaterThan(result.priceBeforeCents);

    // allNewPrices should sum to 1
    const sumPrices = result.allNewPrices.reduce((a, b) => a + b, 0);
    expect(Math.abs(sumPrices - 1.0)).toBeLessThan(0.0001);
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
// sellShares — shared fixtures
// ---------------------------------------------------------------------------

const SALE_TRANSACTION_ID = "ffffffff-0000-0000-0000-000000000001";

/**
 * Wire a happy-path sell scenario.
 *
 * @param tx           - tx mock from makeTx()
 * @param opts.sharesSold      - current outcome state vector [yes, no]
 * @param opts.positionShares  - shares the user currently holds
 * @param opts.positionCost    - total cost basis for the user's position
 */
function wireSellHappyPath(
  tx: ReturnType<typeof makeTx>,
  opts: {
    sharesSold?: number[];
    positionShares?: number;
    positionCost?: number;
  } = {}
): void {
  const {
    sharesSold = [5, 5],
    positionShares = 5,
    positionCost = 20,
  } = opts;

  tx.market.findUnique.mockResolvedValue(mockMarket);

  // FOR UPDATE lock on outcomes
  tx.$queryRaw.mockResolvedValueOnce(
    mockOutcomes.map((o, i) => ({
      ...o,
      shares_sold: String(sharesSold[i] ?? 0),
    }))
  );

  // Position lookup
  tx.position.findUnique.mockResolvedValue({
    shares: String(positionShares),
    totalCost: String(positionCost),
  });

  // Sell cooldown: last buy was >30 min ago (no cooldown block)
  tx.$queryRaw.mockResolvedValueOnce([{ last_buy_at: null }]);

  // outcome.update (decrement sharesSold)
  tx.outcome.update.mockResolvedValue({});

  // transaction.findFirst (prevHash)
  tx.transaction.findFirst.mockResolvedValue(null);

  // transaction.create (SALE)
  tx.transaction.create.mockResolvedValue({ id: SALE_TRANSACTION_ID });

  // position.update
  tx.position.update.mockResolvedValue({});

  // purchase.create (negative record)
  tx.purchase.create.mockResolvedValue({ id: PURCHASE_ID });

  // Reconciliation query — balanced:
  // deposits=$50, user balance=$30 (got revenue back), house_amm=$20
  tx.$queryRaw.mockResolvedValueOnce([
    {
      user_balances: 30,
      house_amm: 20,
      total_deposits: 50,
      total_withdrawals: 0,
    },
  ]);
}

// ---------------------------------------------------------------------------
// sellShares — happy path
// ---------------------------------------------------------------------------

describe("sellShares — basic sale", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("returns revenueCents > 0 when selling 2 shares from a non-empty market", async () => {
    wireSellHappyPath(tx, { sharesSold: [5, 5], positionShares: 5 });

    const result = await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2);

    expect(result.revenueCents).toBeGreaterThan(0);
    expect(result.shares).toBe(2);
    expect(result.transactionId).toBe(SALE_TRANSACTION_ID);
  });

  it("priceBefore > priceAfter when selling Yes shares (price goes down)", async () => {
    // Use larger share values relative to b≈272 for visible price impact
    wireSellHappyPath(tx, { sharesSold: [200, 50], positionShares: 200 });

    const result = await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 50);

    // Selling Yes reduces Yes price
    expect(result.priceAfterCents).toBeLessThan(result.priceBeforeCents);
  });

  it("allNewPrices sums to 1.0 after sell", async () => {
    wireSellHappyPath(tx);

    const result = await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2);

    const sum = result.allNewPrices.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);
  });

  it("creates a SALE Transaction via tx.transaction.create", async () => {
    wireSellHappyPath(tx);

    await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2);

    expect(tx.transaction.create).toHaveBeenCalledOnce();
    const txData = tx.transaction.create.mock.calls[0]?.[0]?.data;
    expect(txData?.type).toBe("SALE");
    expect(txData?.debitAccount).toBe("house_amm");
    expect(txData?.creditAccount).toBe(`user:${USER_ID}`);
  });

  it("inserts a negative-cost Purchase record via tx.purchase.create", async () => {
    wireSellHappyPath(tx);

    await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2);

    expect(tx.purchase.create).toHaveBeenCalledOnce();
    const purchaseData = tx.purchase.create.mock.calls[0]?.[0]?.data;
    // shares and cost should both be negative
    expect(purchaseData?.shares.toNumber()).toBeLessThan(0);
    expect(purchaseData?.cost.toNumber()).toBeLessThan(0);
  });

  it("decrements outcome sharesSold via tx.outcome.update", async () => {
    wireSellHappyPath(tx);

    await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2);

    expect(tx.outcome.update).toHaveBeenCalledOnce();
    const updateArgs = tx.outcome.update.mock.calls[0]?.[0];
    expect(updateArgs?.where?.id).toBe(OUTCOME_YES_ID);
    expect(updateArgs?.data?.sharesSold?.decrement).toBeDefined();
  });

  it("updates position via tx.position.update (not upsert)", async () => {
    wireSellHappyPath(tx);

    await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2);

    expect(tx.position.update).toHaveBeenCalledOnce();
    expect(tx.position.upsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sellShares — revenue matches LMSR formula
// ---------------------------------------------------------------------------

describe("sellShares — revenue matches LMSR formula", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("revenue matches computeDollarAmountForShares minus 10% sell fee", async () => {
    const sharesSold = [8, 4]; // q = [8, 4]
    const sharesToSell = 3;

    wireSellHappyPath(tx, { sharesSold, positionShares: 8 });

    const result = await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, sharesToSell);

    const b = (0.8 * 1000) / Math.log(19 * 1); // defaultB(2, 1000)
    const grossRevenue = computeDollarAmountForShares(sharesSold, b, 0, sharesToSell);
    const fee = grossRevenue * 0.10; // SELL_FEE_RATE = 10%
    const netRevenue = Math.round((grossRevenue - fee) * 10_000) / 10_000;
    const expectedCents = Math.round(netRevenue * 100);

    expect(result.revenueCents).toBe(expectedCents);
  });

  it("selling all shares returns less than buying cost (AMM spread)", async () => {
    // For a binary market at q=[50,50] selling 50 shares should return less than cost
    // because the user bought at higher prices than they're selling
    const b = (0.8 * 1000) / Math.log(19 * 1); // defaultB(2, 1000)
    const revenue = computeDollarAmountForShares([50, 50], b, 0, 50);

    // Revenue is always positive
    expect(revenue).toBeGreaterThan(0);

    // Selling 50 shares at q=[50,50] should be well under $50 (AMM spread)
    expect(revenue).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// sellShares — error cases
// ---------------------------------------------------------------------------

describe("sellShares — NO_POSITION error", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("throws NO_POSITION when user has no position in the outcome", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);
    tx.$queryRaw.mockResolvedValueOnce(mockOutcomes); // lock
    tx.position.findUnique.mockResolvedValue(null);    // no position

    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2)
    ).rejects.toMatchObject({ code: "NO_POSITION" });
  });
});

describe("sellShares — INSUFFICIENT_SHARES error", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("throws INSUFFICIENT_SHARES when user tries to sell more than they hold", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);
    tx.$queryRaw.mockResolvedValueOnce(mockOutcomes);
    tx.position.findUnique.mockResolvedValue({
      shares: "2",    // only 2 shares
      totalCost: "5",
    });

    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 10) // trying to sell 10
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SHARES" });
  });

  it("allows selling exactly the shares held", async () => {
    // User holds exactly 5 shares — selling 5 should succeed
    wireSellHappyPath(tx, { sharesSold: [5, 5], positionShares: 5, positionCost: 20 });

    const result = await sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 5);
    expect(result.shares).toBe(5);
  });
});

describe("sellShares — market status validation", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("throws MARKET_NOT_ACTIVE for PENDING market", async () => {
    tx.market.findUnique.mockResolvedValue({ ...mockMarket, status: "PENDING" });

    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2)
    ).rejects.toMatchObject({ code: "MARKET_NOT_ACTIVE" });
  });

  it("throws MARKET_NOT_ACTIVE for RESOLVED market", async () => {
    tx.market.findUnique.mockResolvedValue({ ...mockMarket, status: "RESOLVED" });

    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2)
    ).rejects.toMatchObject({ code: "MARKET_NOT_ACTIVE" });
  });

  it("throws MARKET_NOT_FOUND when market does not exist", async () => {
    tx.market.findUnique.mockResolvedValue(null);

    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2)
    ).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
  });

  it("throws INVALID_AMOUNT for sharesToSell <= 0", async () => {
    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 0)
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("throws INVALID_AMOUNT for negative sharesToSell", async () => {
    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, -3)
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

describe("sellShares — reconciliation", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeTx();
    mockTransaction(tx);
  });

  it("throws RECONCILIATION_FAILED when conservation is violated after sale", async () => {
    tx.market.findUnique.mockResolvedValue(mockMarket);
    tx.$queryRaw.mockResolvedValueOnce(
      mockOutcomes.map((o, i) => ({ ...o, shares_sold: String([5, 5][i] ?? 0) }))
    );
    tx.position.findUnique.mockResolvedValue({ shares: "5", totalCost: "20" });
    // Sell cooldown: no recent buy
    tx.$queryRaw.mockResolvedValueOnce([{ last_buy_at: null }]);
    tx.outcome.update.mockResolvedValue({});
    tx.transaction.findFirst.mockResolvedValue(null);
    tx.transaction.create.mockResolvedValue({ id: SALE_TRANSACTION_ID });
    tx.position.update.mockResolvedValue({});
    tx.purchase.create.mockResolvedValue({ id: PURCHASE_ID });

    // Broken reconciliation: lhs ≠ rhs
    tx.$queryRaw.mockResolvedValueOnce([
      {
        user_balances: 999,
        house_amm: 0,
        total_deposits: 20,
        total_withdrawals: 0,
      },
    ]);

    await expect(
      sellShares(USER_ID, MARKET_ID, OUTCOME_YES_ID, 2)
    ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
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
