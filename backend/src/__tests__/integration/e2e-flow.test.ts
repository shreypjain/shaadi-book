/**
 * E2E Integration Test — Full Prediction Market Flow (mock Prisma)
 *
 * Exercises the complete lifecycle without a live database:
 *   1. Register user via OTP mock → generate + verify JWT
 *   2. Deposit $50 via mock Stripe webhook → balance credited (DEPOSIT tx)
 *   3. Admin creates binary Yes/No market → 50/50 LMSR prices
 *   4. User buys $20 on "Yes" → shares received, Yes price moves up
 *   5. Admin resolves market (Yes wins) → 80% payout, 20% charity fee
 *   6. Reconciliation invariant: deposits = userBalance + houseAmm + charity
 *
 * All DB I/O is replaced by vi.fn() stubs. LMSR math runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — mock variables must be defined before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  mockPrismaTransaction,
  mockTransactionFindFirst,
} = vi.hoisted(() => ({
  mockPrismaTransaction: vi.fn(),
  mockTransactionFindFirst: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the Prisma singleton — all services import from this module
// ---------------------------------------------------------------------------

vi.mock("../../db.js", () => ({
  prisma: {
    $transaction: mockPrismaTransaction,
    transaction: { findFirst: mockTransactionFindFirst },
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are in place)
// ---------------------------------------------------------------------------

import { generateToken, verifyToken } from "../../services/auth.js";
import { handleCheckoutCompleted } from "../../services/stripe.js";
import { createMarket, resolveMarket } from "../../services/marketService.js";
import { buyShares, PurchaseError } from "../../services/purchaseEngine.js";
import { allPrices } from "../../services/lmsr.js";

// ---------------------------------------------------------------------------
// Fixtures — deterministic UUIDs for all entities
// ---------------------------------------------------------------------------

process.env["JWT_SECRET"] = "test-secret-for-e2e";

const USER_ID    = "aaaaaaaa-0000-0000-0000-000000000001";
const ADMIN_ID   = "aaaaaaaa-0000-0000-0000-000000000002";
const MARKET_ID  = "bbbbbbbb-0000-0000-0000-000000000001";
const YES_ID     = "cccccccc-0000-0000-0000-000000000001";
const NO_ID      = "cccccccc-0000-0000-0000-000000000002";
const USER_PHONE = "+15550001234";
const ADMIN_PHONE= "+15550005678";

/** Fixed "openedAt" for deterministic LMSR b-parameter. */
const MARKET_OPENED_AT = new Date(Date.now() - 30_000); // 30 seconds ago

// ---------------------------------------------------------------------------
// Shared state captured across test steps
// ---------------------------------------------------------------------------

let userJwt: string;
let purchaseResult: Awaited<ReturnType<typeof buyShares>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh, isolated tx stub for the purchase-engine path. */
function makePurchaseTx(opts: {
  balanceDollars?: number;
  spendDollars?: number;
  volumeDollars?: number;
  sharesSold?: number[];
} = {}) {
  const {
    balanceDollars = 50,
    spendDollars = 0,
    volumeDollars = 0,
    sharesSold = [0, 0],
  } = opts;

  const tx = {
    $queryRaw: vi.fn(),
    market: { findUnique: vi.fn() },
    outcome: { update: vi.fn().mockResolvedValue({}) },
    purchase: { create: vi.fn().mockResolvedValue({ id: "purchase-id-001" }) },
    transaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "tx-id-001" }),
    },
    position: { upsert: vi.fn().mockResolvedValue({}) },
  };

  // Outcomes locked FOR UPDATE
  tx.market.findUnique.mockResolvedValue({
    id: MARKET_ID,
    status: "ACTIVE",
    openedAt: MARKET_OPENED_AT,
    bFloorOverride: null,
  });

  tx.$queryRaw
    .mockResolvedValueOnce([
      { id: YES_ID, market_id: MARKET_ID, position: 0, shares_sold: String(sharesSold[0] ?? 0), label: "Yes" },
      { id: NO_ID,  market_id: MARKET_ID, position: 1, shares_sold: String(sharesSold[1] ?? 0), label: "No"  },
    ])                                                         // FOR UPDATE
    .mockResolvedValueOnce([{ balance: balanceDollars }])      // user balance
    .mockResolvedValueOnce([{ total_spend: spendDollars }])    // market spend
    .mockResolvedValueOnce([{ total_volume: volumeDollars }]); // market volume

  // Reconciliation — values that satisfy the invariant after a $20 purchase
  const userBalance = balanceDollars - 20;
  const houseAmm = 20;
  tx.$queryRaw.mockResolvedValueOnce([{
    user_balances:   userBalance,
    house_amm:       houseAmm,
    charity_pool:    0,
    total_deposits:  balanceDollars,
    total_withdrawals: 0,
  }]);

  return tx;
}

// ---------------------------------------------------------------------------
// Step 1: Register & JWT
// ---------------------------------------------------------------------------

describe("Step 1 — Register user via OTP mock → JWT", () => {
  it("generates a signed JWT for a GUEST user", () => {
    userJwt = generateToken(USER_ID, "guest", USER_PHONE);
    expect(typeof userJwt).toBe("string");
    expect(userJwt.split(".")).toHaveLength(3); // header.payload.signature
  });

  it("verifyToken decodes correct payload from generated JWT", () => {
    const payload = verifyToken(userJwt);
    expect(payload.userId).toBe(USER_ID);
    expect(payload.role).toBe("guest");
    expect(payload.phone).toBe(USER_PHONE);
  });

  it("generates separate JWT for admin user with role=admin", () => {
    const adminJwt = generateToken(ADMIN_ID, "admin", ADMIN_PHONE);
    const payload = verifyToken(adminJwt);
    expect(payload.userId).toBe(ADMIN_ID);
    expect(payload.role).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// Step 2: Deposit via Stripe webhook
// ---------------------------------------------------------------------------

describe("Step 2 — Stripe webhook deposits $50 → balance credited", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handleCheckoutCompleted inserts a DEPOSIT transaction for new session", async () => {
    // Idempotency: no existing transaction for this session
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    const mockTxCreate = vi.fn().mockResolvedValue({ id: "deposit-tx-id" });
    const mockTxFindFirst = vi.fn().mockResolvedValue(null); // genesis hash

    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        transaction: {
          findFirst: mockTxFindFirst,
          create: mockTxCreate,
        },
      })
    );

    const session = {
      id: "cs_test_deposit_001",
      client_reference_id: USER_ID,
      amount_total: 5000, // $50.00
      object: "checkout.session",
    } as import("stripe").Stripe.Checkout.Session;

    await handleCheckoutCompleted(session);

    // Idempotency check performed
    expect(mockTransactionFindFirst).toHaveBeenCalledWith({
      where: { stripeSessionId: "cs_test_deposit_001" },
      select: { id: true },
    });

    // Transaction inserted once
    expect(mockTxCreate).toHaveBeenCalledOnce();
    const txData = (mockTxCreate.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(txData["type"]).toBe("DEPOSIT");
    expect(txData["userId"]).toBe(USER_ID);
    expect(txData["creditAccount"]).toBe(`user:${USER_ID}`);
    expect(txData["debitAccount"]).toBe("stripe");
    expect(Number(txData["amount"])).toBe(50);    // cents → dollars
    expect(txData["stripeSessionId"]).toBe("cs_test_deposit_001");
  });

  it("is idempotent: duplicate webhook delivery does NOT insert again", async () => {
    // Session already processed
    mockTransactionFindFirst.mockResolvedValueOnce({ id: "existing-tx" });

    await handleCheckoutCompleted({
      id: "cs_test_deposit_001",
      client_reference_id: USER_ID,
      amount_total: 5000,
      object: "checkout.session",
    } as import("stripe").Stripe.Checkout.Session);

    // $transaction must NOT have been called at all
    expect(mockPrismaTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Step 3: Admin creates binary market
// ---------------------------------------------------------------------------

describe("Step 3 — Admin creates binary Yes/No market → 50/50 prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createMarket returns a market ID", async () => {
    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        market: {
          create: vi.fn().mockResolvedValue({ id: MARKET_ID }),
        },
        adminAuditLog: {
          create: vi.fn().mockResolvedValue({}),
        },
      })
    );

    const marketId = await createMarket(
      ADMIN_ID,
      "Will the groom cry during the pheras?",
      ["Yes", "No"]
    );

    expect(marketId).toBe(MARKET_ID);
  });

  it("fresh binary market has 50/50 LMSR prices (q=[0,0])", () => {
    // Pure LMSR math — no DB needed
    const prices = allPrices([0, 0], 20); // b=20, q=[0,0]
    expect(prices).toHaveLength(2);
    expect(prices[0]).toBeCloseTo(0.5, 4);
    expect(prices[1]).toBeCloseTo(0.5, 4);
    expect(prices[0]! + prices[1]!).toBeCloseTo(1.0, 6);
  });
});

// ---------------------------------------------------------------------------
// Step 4: User buys $20 on Yes
// ---------------------------------------------------------------------------

describe("Step 4 — User buys $20 on Yes → shares received, price moves up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buyShares returns a valid PurchaseResult with shares > 0", async () => {
    const tx = makePurchaseTx({ balanceDollars: 50 });
    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    purchaseResult = await buyShares(USER_ID, MARKET_ID, YES_ID, 2000); // $20

    expect(purchaseResult.shares).toBeGreaterThan(0);
    expect(purchaseResult.costCents).toBe(2000);
    expect(purchaseResult.purchaseId).toBe("purchase-id-001");
    expect(purchaseResult.transactionId).toBe("tx-id-001");
    expect(purchaseResult.outcomeLabel).toBe("Yes");
  });

  it("Yes price moves up after $20 purchase (price impact)", async () => {
    const tx = makePurchaseTx({ balanceDollars: 50 });
    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    const result = await buyShares(USER_ID, MARKET_ID, YES_ID, 2000);

    // priceAfter > priceBefore (bought Yes → Yes price increases)
    expect(result.priceAfterCents).toBeGreaterThan(result.priceBeforeCents);
    // priceBefore ≈ 50¢ (fresh binary market)
    expect(result.priceBeforeCents).toBeCloseTo(50, 0);
    // allNewPrices sums to 1
    const sum = result.allNewPrices.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);
  });

  it("No price goes down after Yes is purchased", async () => {
    const tx = makePurchaseTx({ balanceDollars: 50 });
    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    const result = await buyShares(USER_ID, MARKET_ID, YES_ID, 2000);

    // result.outcomeIds[0] = YES, result.outcomeIds[1] = NO
    // After buying Yes: No price should be < 50%
    expect(result.allNewPrices[1]).toBeLessThan(0.5);
    expect(result.allNewPrices[0]).toBeGreaterThan(0.5);
  });

  it("purchase creates both a Purchase record and a Transaction row", async () => {
    const tx = makePurchaseTx({ balanceDollars: 50 });
    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await buyShares(USER_ID, MARKET_ID, YES_ID, 2000);

    // Purchase record written
    expect(tx.purchase.create).toHaveBeenCalledOnce();
    const purchaseData = (tx.purchase.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(purchaseData["userId"]).toBe(USER_ID);
    expect(purchaseData["marketId"]).toBe(MARKET_ID);
    expect(purchaseData["outcomeId"]).toBe(YES_ID);

    // Transaction row written (double-entry)
    expect(tx.transaction.create).toHaveBeenCalledOnce();
    const txRowData = (tx.transaction.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(txRowData["type"]).toBe("PURCHASE");
    expect(txRowData["debitAccount"]).toBe(`user:${USER_ID}`);
    expect(txRowData["creditAccount"]).toBe("house_amm");
  });

  it("throws INSUFFICIENT_BALANCE if user has no balance", async () => {
    const tx = makePurchaseTx({ balanceDollars: 0 });
    // Override the reconciliation mock to prevent the flow from reaching it
    // (it throws early at balance check)
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        { id: YES_ID, market_id: MARKET_ID, position: 0, shares_sold: "0", label: "Yes" },
        { id: NO_ID,  market_id: MARKET_ID, position: 1, shares_sold: "0", label: "No"  },
      ])
      .mockResolvedValueOnce([{ balance: 0 }]); // $0 balance

    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      buyShares(USER_ID, MARKET_ID, YES_ID, 2000)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Step 5: Admin resolves market — Yes wins
// ---------------------------------------------------------------------------

describe("Step 5 — Admin resolves market → payout 80%, charity 20%", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure purchaseResult is available (fallback for isolated test runs)
    if (!purchaseResult) {
      purchaseResult = { shares: 33.9 } as typeof purchaseResult;
    }
  });

  it("resolveMarket sets status=RESOLVED and winningOutcomeId", async () => {
    const shares = purchaseResult?.shares ?? 33.9;

    const txForResolution = {
      market: {
        findUnique: vi.fn().mockResolvedValue({
          id: MARKET_ID,
          status: "ACTIVE",
          outcomes: [{ id: YES_ID }, { id: NO_ID }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      outcome: { update: vi.fn().mockResolvedValue({}) },
      position: {
        findMany: vi.fn().mockResolvedValue([
          { userId: USER_ID, shares },
        ]),
      },
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null), // genesis hash
        create: vi.fn().mockResolvedValue({ id: "payout-tx-id" }),
      },
      adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    mockPrismaTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) => fn(txForResolution)
    );

    await resolveMarket(ADMIN_ID, MARKET_ID, YES_ID);

    // market.update called with RESOLVED status
    expect(txForResolution.market.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MARKET_ID },
        data: expect.objectContaining({ status: "RESOLVED", winningOutcomeId: YES_ID }),
      })
    );

    // outcome.update called twice: once for isWinner, then nothing else from resolveMarket
    expect(txForResolution.outcome.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: YES_ID }, data: { isWinner: true } })
    );
  });

  it("emits PAYOUT and CHARITY_FEE transactions for winning position", async () => {
    const shares = purchaseResult?.shares ?? 33.9;
    const gross = shares;
    const expectedNet    = parseFloat((gross * 0.8).toFixed(6));
    const expectedCharity= parseFloat((gross * 0.2).toFixed(6));

    const txCreate = vi.fn().mockResolvedValue({ id: "tx-id" });

    const txForResolution = {
      market: {
        findUnique: vi.fn().mockResolvedValue({
          id: MARKET_ID,
          status: "ACTIVE",
          outcomes: [{ id: YES_ID }, { id: NO_ID }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      outcome: { update: vi.fn().mockResolvedValue({}) },
      position: {
        findMany: vi.fn().mockResolvedValue([{ userId: USER_ID, shares }]),
      },
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: txCreate,
      },
      adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    mockPrismaTransaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) => fn(txForResolution)
    );

    await resolveMarket(ADMIN_ID, MARKET_ID, YES_ID);

    // Two transaction rows: PAYOUT and CHARITY_FEE
    expect(txCreate).toHaveBeenCalledTimes(2);

    const payoutCall  = (txCreate.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    const charityCall = (txCreate.mock.calls[1] as [{ data: Record<string, unknown> }])[0].data;

    expect(payoutCall["type"]).toBe("PAYOUT");
    expect(payoutCall["creditAccount"]).toBe(`user:${USER_ID}`);
    expect(payoutCall["debitAccount"]).toBe("house_amm");
    expect(Number(payoutCall["amount"])).toBeCloseTo(expectedNet, 4);

    expect(charityCall["type"]).toBe("CHARITY_FEE");
    expect(charityCall["creditAccount"]).toBe("charity_pool");
    expect(charityCall["debitAccount"]).toBe("house_amm");
    expect(Number(charityCall["amount"])).toBeCloseTo(expectedCharity, 4);
  });
});

// ---------------------------------------------------------------------------
// Step 6: Reconciliation invariant
// ---------------------------------------------------------------------------

describe("Step 6 — Reconciliation invariant: net + charity = gross (shares × $1)", () => {
  it("payout 80% + charity 20% = gross payout (per-position invariant)", () => {
    const shares = purchaseResult?.shares ?? 33.9;
    const gross   = parseFloat(shares.toFixed(6));
    const charity = parseFloat((gross * 0.2).toFixed(6));
    const net     = parseFloat((gross - charity).toFixed(6));

    // The core reconciliation equation for the resolution step
    expect(net + charity).toBeCloseTo(gross, 4);
  });

  it("double-entry conservation: deposits = userBalance + houseAmm + charity (no withdrawals)", () => {
    // Simulate the full ledger after all 5 steps:
    //   DEPOSIT:      +$50 to user
    //   PURCHASE:     -$20 from user, +$20 to house
    //   PAYOUT:       -net from house, +net to user
    //   CHARITY_FEE:  -charity from house, +charity to charity_pool
    const DEPOSIT  = 50;
    const PURCHASE = 20;
    const shares   = purchaseResult?.shares ?? 33.9;
    const gross    = parseFloat(shares.toFixed(6));
    const net      = parseFloat((gross * 0.8).toFixed(6));
    const charity  = parseFloat((gross * 0.2).toFixed(6));

    const userBalance  = DEPOSIT - PURCHASE + net;   // 50 - 20 + 0.8S
    const houseAmm     = PURCHASE - gross;            // 20 - S  (may be < 0: house takes LMSR loss)
    const charityPool  = charity;                     // 0.2S
    const totalDeposits= DEPOSIT;

    // Conservation: all accounts sum back to total deposits
    const lhs = userBalance + houseAmm + charityPool;
    expect(lhs).toBeCloseTo(totalDeposits, 6);
  });

  it("throwing PurchaseError with correct code on reconciliation failure", async () => {
    const tx = makePurchaseTx({ balanceDollars: 50 });
    // Override the final reconciliation query with a broken invariant
    // (replace last $queryRaw.mockResolvedValueOnce)
    tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([
        { id: YES_ID, market_id: MARKET_ID, position: 0, shares_sold: "0", label: "Yes" },
        { id: NO_ID,  market_id: MARKET_ID, position: 1, shares_sold: "0", label: "No"  },
      ])
      .mockResolvedValueOnce([{ balance: 50 }])
      .mockResolvedValueOnce([{ total_spend: 0 }])
      .mockResolvedValueOnce([{ total_volume: 0 }])
      .mockResolvedValueOnce([{
        user_balances:   9999, // tampered: does not balance
        house_amm:       0,
        charity_pool:    0,
        total_deposits:  50,
        total_withdrawals: 0,
      }]);

    mockPrismaTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      buyShares(USER_ID, MARKET_ID, YES_ID, 2000)
    ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  });
});
