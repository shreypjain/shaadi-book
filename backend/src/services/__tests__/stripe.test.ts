/**
 * Stripe service tests — Task 3.1 + stripe-fee-from-charity
 *
 * Coverage:
 *   estimateStripeFee:
 *     - $25 deposit → correct fee (2.9% + $0.30)
 *     - $10 deposit → correct fee
 *     - $50 deposit → correct fee
 *     - returns integer cents
 *
 *   createDepositSession:
 *     - creates session with correct Stripe parameters
 *     - returns the checkout URL
 *     - uses NEXT_PUBLIC_APP_URL for success/cancel redirects
 *     - falls back to localhost:3000 when NEXT_PUBLIC_APP_URL is unset
 *     - throws when STRIPE_SECRET_KEY is missing
 *     - throws when Stripe returns no URL
 *     - propagates Stripe API errors
 *
 *   handleCheckoutCompleted:
 *     - inserts DEPOSIT + STRIPE_FEE transactions for a new session
 *     - DEPOSIT credits the correct user with the full gross amount
 *     - DEPOSIT uses correct double-entry accounts (debit: stripe, credit: user:{id})
 *     - STRIPE_FEE uses correct double-entry (debit: charity_pool, credit: stripe_processor)
 *     - STRIPE_FEE amount = estimateStripeFee(amountCents) / 100
 *     - STRIPE_FEE chains from DEPOSIT txHash (prevHash = DEPOSIT txHash)
 *     - Both rows share the same stripeSessionId
 *     - stores stripeSessionId on both rows for idempotency
 *     - builds the hash chain (prevHash/txHash)
 *     - is idempotent: second call with same session does NOT insert again
 *     - does not throw on duplicate delivery (returns cleanly)
 *     - throws when client_reference_id is missing
 *     - throws when amount_total is null
 *     - propagates Prisma errors from the transaction block
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

// ---------------------------------------------------------------------------
// vi.hoisted — variables used inside vi.mock factories must be hoisted so
// they are initialised before the factory runs (Vitest transforms vi.mock()
// to the top of the file before any other code).
// ---------------------------------------------------------------------------

const {
  mockCheckoutSessionsCreate,
  mockTransactionFindFirst,
  mockPrismaTransaction,
  mockTxCreate,
  mockGetLastHash,
  mockComputeHash,
} = vi.hoisted(() => ({
  mockCheckoutSessionsCreate: vi.fn(),
  mockTransactionFindFirst: vi.fn(),
  mockPrismaTransaction: vi.fn(),
  mockTxCreate: vi.fn(),
  mockGetLastHash: vi.fn(),
  mockComputeHash: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stripe SDK mock
// ---------------------------------------------------------------------------

vi.mock("stripe", () => {
  const MockStripe = vi.fn(() => ({
    checkout: {
      sessions: { create: mockCheckoutSessionsCreate },
    },
  }));
  return { default: MockStripe };
});

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

vi.mock("../../db.js", () => ({
  prisma: {
    transaction: {
      findFirst: mockTransactionFindFirst,
    },
    $transaction: mockPrismaTransaction,
  },
}));

// ---------------------------------------------------------------------------
// hashChain mock
// ---------------------------------------------------------------------------

vi.mock("../hashChain.js", () => ({
  getLastHash: mockGetLastHash,
  computeHash: mockComputeHash,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are in place)
// ---------------------------------------------------------------------------

import { createDepositSession, handleCheckoutCompleted, estimateStripeFee } from "../stripe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Stripe Checkout.Session stub. */
function makeSession(
  overrides: Partial<Stripe.Checkout.Session> = {}
): Stripe.Checkout.Session {
  return {
    id: "cs_test_abc123",
    client_reference_id: "user-456",
    amount_total: 2500,
    object: "checkout.session",
    ...overrides,
  } as Stripe.Checkout.Session;
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_dummy";
  process.env["NEXT_PUBLIC_APP_URL"] = "https://shaadibook.app";

  vi.clearAllMocks();

  // Default hash chain stubs (applied after clearAllMocks)
  mockGetLastHash.mockResolvedValue("0".repeat(64));
  mockComputeHash.mockReturnValue("a".repeat(64));

  // Default $transaction: invoke the callback with a mock tx client
  mockPrismaTransaction.mockImplementation(async (callback: unknown) => {
    const fn = callback as (tx: {
      transaction: { create: typeof mockTxCreate };
    }) => Promise<unknown>;
    return fn({ transaction: { create: mockTxCreate } });
  });
});

afterEach(() => {
  delete process.env["STRIPE_SECRET_KEY"];
  delete process.env["NEXT_PUBLIC_APP_URL"];
});

// ---------------------------------------------------------------------------
// estimateStripeFee
// ---------------------------------------------------------------------------

describe("estimateStripeFee", () => {
  it("$25 deposit (2500 cents) → 103 cents (2.9% × 2500 + 30 = 102.5 → rounded to 103)", () => {
    // 2500 * 0.029 = 72.5, + 30 = 102.5 → round → 103
    expect(estimateStripeFee(2500)).toBe(103);
  });

  it("$10 deposit (1000 cents) → 59 cents (2.9% × 1000 + 30 = 59)", () => {
    // 1000 * 0.029 = 29, + 30 = 59
    expect(estimateStripeFee(1000)).toBe(59);
  });

  it("$50 deposit (5000 cents) → 175 cents (2.9% × 5000 + 30 = 175)", () => {
    // 5000 * 0.029 = 145, + 30 = 175
    expect(estimateStripeFee(5000)).toBe(175);
  });

  it("returns an integer (no fractional cents)", () => {
    const fee = estimateStripeFee(1234);
    expect(Number.isInteger(fee)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createDepositSession
// ---------------------------------------------------------------------------

describe("createDepositSession", () => {
  it("creates a Checkout Session with the correct Stripe parameters", async () => {
    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });

    await createDepositSession("user-123", 2500);

    expect(mockCheckoutSessionsCreate).toHaveBeenCalledOnce();
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith({
      mode: "payment",
      currency: "usd",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Shaadi Book Credits" },
            unit_amount: 2500,
          },
          quantity: 1,
        },
      ],
      client_reference_id: "user-123",
      success_url: "https://shaadibook.app/wallet?deposit=success",
      cancel_url: "https://shaadibook.app/wallet?deposit=cancelled",
    });
  });

  it("returns the Stripe Checkout URL", async () => {
    const expectedUrl = "https://checkout.stripe.com/pay/cs_test_456";
    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_test_456",
      url: expectedUrl,
    });

    const url = await createDepositSession("user-789", 5000);
    expect(url).toBe(expectedUrl);
  });

  it("uses the preset amount $10 (1000 cents) correctly", async () => {
    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_test_10",
      url: "https://checkout.stripe.com/pay/cs_test_10",
    });

    await createDepositSession("user-abc", 1000);

    const call = mockCheckoutSessionsCreate.mock.calls[0]?.[0] as {
      line_items: Array<{ price_data: { unit_amount: number } }>;
    };
    expect(call.line_items[0]?.price_data.unit_amount).toBe(1000);
  });

  it("falls back to localhost:3000 when NEXT_PUBLIC_APP_URL is unset", async () => {
    delete process.env["NEXT_PUBLIC_APP_URL"];
    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_test_local",
      url: "https://checkout.stripe.com/pay/cs_test_local",
    });

    await createDepositSession("user-xyz", 2500);

    const call = mockCheckoutSessionsCreate.mock.calls[0]?.[0] as {
      success_url: string;
      cancel_url: string;
    };
    expect(call.success_url).toContain("localhost:3000");
    expect(call.cancel_url).toContain("localhost:3000");
  });

  it("throws when STRIPE_SECRET_KEY is not set", async () => {
    delete process.env["STRIPE_SECRET_KEY"];
    await expect(createDepositSession("user-123", 2500)).rejects.toThrow(
      "STRIPE_SECRET_KEY"
    );
  });

  it("throws when Stripe returns a session with no URL", async () => {
    mockCheckoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_test_nurl",
      url: null,
    });
    await expect(createDepositSession("user-123", 2500)).rejects.toThrow();
  });

  it("propagates Stripe API errors", async () => {
    mockCheckoutSessionsCreate.mockRejectedValueOnce(
      new Error("Stripe API error: invalid currency")
    );
    await expect(createDepositSession("user-123", 2500)).rejects.toThrow(
      "Stripe API error"
    );
  });
});

// ---------------------------------------------------------------------------
// handleCheckoutCompleted
// ---------------------------------------------------------------------------

describe("handleCheckoutCompleted", () => {
  it("inserts DEPOSIT + STRIPE_FEE transactions for a new (unprocessed) session", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession());

    // Idempotency check was performed with the correct session ID
    expect(mockTransactionFindFirst).toHaveBeenCalledWith({
      where: { stripeSessionId: "cs_test_abc123" },
      select: { id: true },
    });

    // The Prisma transaction was started
    expect(mockPrismaTransaction).toHaveBeenCalledOnce();

    // Two rows inserted: DEPOSIT + STRIPE_FEE
    expect(mockTxCreate).toHaveBeenCalledTimes(2);

    const { data: depositData } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(depositData["type"]).toBe("DEPOSIT");
    expect(depositData["userId"]).toBe("user-456");
    expect(depositData["stripeSessionId"]).toBe("cs_test_abc123");

    const { data: feeData } = mockTxCreate.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(feeData["type"]).toBe("STRIPE_FEE");
    expect(feeData["userId"]).toBe("user-456");
    expect(feeData["stripeSessionId"]).toBe("cs_test_abc123");
  });

  it("DEPOSIT uses correct double-entry accounts (debit: stripe, credit: user:{id})", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession());

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["debitAccount"]).toBe("stripe");
    expect(data["creditAccount"]).toBe("user:user-456");
  });

  it("STRIPE_FEE uses correct double-entry (debit: charity_pool, credit: stripe_processor)", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession());

    const { data } = mockTxCreate.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["debitAccount"]).toBe("charity_pool");
    expect(data["creditAccount"]).toBe("stripe_processor");
  });

  it("STRIPE_FEE amount = estimateStripeFee(2500) / 100 = 1.03", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession({ amount_total: 2500 }));

    const { data } = mockTxCreate.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    // estimateStripeFee(2500) = round(2500*0.029+30) = 103 cents = $1.03
    expect(Number(data["amount"])).toBeCloseTo(1.03, 5);
  });

  it("STRIPE_FEE prevHash chains from the DEPOSIT txHash", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    const depositHash = "d".repeat(64);
    const feeHash = "f".repeat(64);
    // computeHash called twice: first for DEPOSIT, then for STRIPE_FEE
    mockComputeHash
      .mockReturnValueOnce(depositHash)
      .mockReturnValueOnce(feeHash);

    await handleCheckoutCompleted(makeSession());

    const { data: feeData } = mockTxCreate.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    // STRIPE_FEE must use DEPOSIT's txHash as its prevHash
    expect(feeData["prevHash"]).toBe(depositHash);
    expect(feeData["txHash"]).toBe(feeHash);
  });

  it("converts amountCents to dollars for DEPOSIT (2500 cents → 25)", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession({ amount_total: 2500 }));

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // Decimal(2500).div(100) == 25
    expect(Number(data["amount"])).toBe(25);
  });

  it("stores stripeSessionId on both DEPOSIT and STRIPE_FEE rows", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession({ id: "cs_unique_999" }));

    const { data: depositData } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    const { data: feeData } = mockTxCreate.mock.calls[1]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(depositData["stripeSessionId"]).toBe("cs_unique_999");
    expect(feeData["stripeSessionId"]).toBe("cs_unique_999");
  });

  it("builds the hash chain: computeHash called twice (DEPOSIT then STRIPE_FEE)", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    const fakePrevHash = "f".repeat(64);
    const fakeDepositHash = "e".repeat(64);
    const fakeFeeHash = "a".repeat(64);
    mockGetLastHash.mockResolvedValueOnce(fakePrevHash);
    mockComputeHash
      .mockReturnValueOnce(fakeDepositHash)
      .mockReturnValueOnce(fakeFeeHash);

    await handleCheckoutCompleted(makeSession());

    // computeHash called twice
    expect(mockComputeHash).toHaveBeenCalledTimes(2);

    // First call: DEPOSIT
    const [prevArg, typeArg, , userIdArg] = mockComputeHash.mock.calls[0] as [
      string,
      string,
      string,
      string
    ];
    expect(prevArg).toBe(fakePrevHash);
    expect(typeArg).toBe("DEPOSIT");
    expect(userIdArg).toBe("user-456");

    // Second call: STRIPE_FEE, prevHash = deposit txHash
    const [feePrevArg, feeTypeArg] = mockComputeHash.mock.calls[1] as [
      string,
      string
    ];
    expect(feePrevArg).toBe(fakeDepositHash);
    expect(feeTypeArg).toBe("STRIPE_FEE");

    // DEPOSIT row hashes
    const { data: depositData } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(depositData["prevHash"]).toBe(fakePrevHash);
    expect(depositData["txHash"]).toBe(fakeDepositHash);
  });

  // -------------------------------------------------------------------------
  // Idempotency — the core correctness requirement
  // -------------------------------------------------------------------------

  it("is idempotent — second call with same session does NOT insert another row", async () => {
    // First call: session not yet in DB → inserts DEPOSIT + STRIPE_FEE
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    await handleCheckoutCompleted(makeSession());
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxCreate).toHaveBeenCalledTimes(2); // DEPOSIT + STRIPE_FEE

    // Second call with the same session: already processed
    mockTransactionFindFirst.mockResolvedValueOnce({ id: "existing-tx-id" });
    await handleCheckoutCompleted(makeSession());

    // $transaction must NOT have been called a second time
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    // tx.transaction.create still only 2 total (no new rows)
    expect(mockTxCreate).toHaveBeenCalledTimes(2);
  });

  it("does not throw on duplicate delivery — returns cleanly", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce({ id: "already-done" });
    await expect(
      handleCheckoutCompleted(makeSession())
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it("throws when client_reference_id is null", async () => {
    const session = makeSession({ client_reference_id: null });
    await expect(handleCheckoutCompleted(session)).rejects.toThrow(
      "client_reference_id"
    );
    // Should not have touched the DB at all
    expect(mockTransactionFindFirst).not.toHaveBeenCalled();
  });

  it("throws when amount_total is null", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    const session = makeSession({ amount_total: null });
    await expect(handleCheckoutCompleted(session)).rejects.toThrow(
      "amount_total"
    );
  });

  it("propagates Prisma errors from the $transaction block", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    mockPrismaTransaction.mockRejectedValueOnce(new Error("DB connection lost"));
    await expect(handleCheckoutCompleted(makeSession())).rejects.toThrow(
      "DB connection lost"
    );
  });
});
