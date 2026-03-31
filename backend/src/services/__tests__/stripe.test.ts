/**
 * Stripe service tests
 *
 * Coverage:
 *   estimateStripeFee:
 *     - $25 deposit → correct fee (2.9% + $0.30)
 *     - $10 deposit → correct fee
 *     - $50 deposit → correct fee
 *     - returns integer cents
 *
 *   createPaymentIntent:
 *     - creates PaymentIntent with correct Stripe parameters
 *     - returns clientSecret and paymentIntentId
 *     - throws when STRIPE_SECRET_KEY is missing
 *     - throws when Stripe returns no client_secret
 *     - propagates Stripe API errors
 *
 *   handlePaymentIntentSucceeded:
 *     - inserts DEPOSIT transaction for a new (unprocessed) payment
 *     - DEPOSIT uses correct double-entry accounts (debit: stripe, credit: user:{id})
 *     - converts amountCents to dollars correctly (2500 → 25)
 *     - stores paymentIntentId as stripeSessionId for idempotency
 *     - builds the hash chain (prevHash/txHash)
 *     - is idempotent: second call with same id does NOT insert again
 *     - does not throw on duplicate delivery (returns cleanly)
 *     - throws when metadata.userId is missing
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
  mockPaymentIntentsCreate,
  mockTransactionFindFirst,
  mockPrismaTransaction,
  mockTxCreate,
  mockGetLastHash,
  mockComputeHash,
  mockUserFindUnique,
} = vi.hoisted(() => ({
  mockPaymentIntentsCreate: vi.fn(),
  mockTransactionFindFirst: vi.fn(),
  mockPrismaTransaction: vi.fn(),
  mockTxCreate: vi.fn(),
  mockGetLastHash: vi.fn(),
  mockComputeHash: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stripe SDK mock
// ---------------------------------------------------------------------------

vi.mock("stripe", () => {
  const MockStripe = vi.fn(() => ({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
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
    user: {
      findUnique: mockUserFindUnique,
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

import {
  createPaymentIntent,
  handlePaymentIntentSucceeded,
  estimateStripeFee,
} from "../stripe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Stripe PaymentIntent stub. */
function makePaymentIntent(
  overrides: Partial<Stripe.PaymentIntent> = {}
): Stripe.PaymentIntent {
  return {
    id: "pi_test_abc123",
    metadata: { userId: "user-456" },
    amount: 2500,
    object: "payment_intent",
    ...overrides,
  } as Stripe.PaymentIntent;
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_dummy";

  vi.clearAllMocks();

  // Default: user lookup returns US country
  mockUserFindUnique.mockResolvedValue({ country: "US" });

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
// createPaymentIntent
// ---------------------------------------------------------------------------

describe("createPaymentIntent", () => {
  it("creates a PaymentIntent with the correct Stripe parameters", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_test_123",
      client_secret: "pi_test_123_secret_xyz",
    });

    await createPaymentIntent(2500, "user-123");

    expect(mockPaymentIntentsCreate).toHaveBeenCalledOnce();
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
      amount: 2500,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { userId: "user-123", originalUsdCents: "2500" },
    });
  });

  it("returns clientSecret and paymentIntentId", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_test_456",
      client_secret: "pi_test_456_secret_xyz",
    });

    const result = await createPaymentIntent(5000, "user-789");
    expect(result.clientSecret).toBe("pi_test_456_secret_xyz");
    expect(result.paymentIntentId).toBe("pi_test_456");
  });

  it("throws when STRIPE_SECRET_KEY is not set", async () => {
    delete process.env["STRIPE_SECRET_KEY"];
    await expect(createPaymentIntent(2500, "user-123")).rejects.toThrow(
      "STRIPE_SECRET_KEY"
    );
  });

  it("throws when Stripe returns a PaymentIntent with no client_secret", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_test_ncs",
      client_secret: null,
    });
    await expect(createPaymentIntent(2500, "user-123")).rejects.toThrow();
  });

  it("propagates Stripe API errors", async () => {
    mockPaymentIntentsCreate.mockRejectedValueOnce(
      new Error("Stripe API error: invalid currency")
    );
    await expect(createPaymentIntent(2500, "user-123")).rejects.toThrow(
      "Stripe API error"
    );
  });

  it("creates INR PaymentIntent with UPI for Indian users", async () => {
    mockUserFindUnique.mockResolvedValueOnce({ country: "IN" });
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_inr_001",
      client_secret: "pi_inr_001_secret",
    });

    await createPaymentIntent(1000, "user-in-123"); // $10 = 1000 USD cents

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
      amount: 85000, // 1000 * 85 = 85000 paise = ₹850
      currency: "inr",
      payment_method_types: ["upi", "card"],
      metadata: { userId: "user-in-123", originalUsdCents: "1000" },
    });
  });
});

// ---------------------------------------------------------------------------
// handlePaymentIntentSucceeded
// ---------------------------------------------------------------------------

describe("handlePaymentIntentSucceeded", () => {
  it("inserts DEPOSIT transaction for a new (unprocessed) payment", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handlePaymentIntentSucceeded(makePaymentIntent());

    // Idempotency check was performed with the correct paymentIntentId
    expect(mockTransactionFindFirst).toHaveBeenCalledWith({
      where: { stripeSessionId: "pi_test_abc123" },
      select: { id: true },
    });

    // The Prisma transaction was started
    expect(mockPrismaTransaction).toHaveBeenCalledOnce();

    // One row inserted: DEPOSIT only
    expect(mockTxCreate).toHaveBeenCalledTimes(1);

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["type"]).toBe("DEPOSIT");
    expect(data["userId"]).toBe("user-456");
    expect(data["stripeSessionId"]).toBe("pi_test_abc123");
  });

  it("DEPOSIT uses correct double-entry accounts (debit: stripe, credit: user:{id})", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handlePaymentIntentSucceeded(makePaymentIntent());

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["debitAccount"]).toBe("stripe");
    expect(data["creditAccount"]).toBe("user:user-456");
  });

  it("converts amountCents to dollars for DEPOSIT (2500 cents → $25)", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handlePaymentIntentSucceeded(makePaymentIntent({ amount: 2500 }));

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(Number(data["amount"])).toBe(25);
  });

  it("uses originalUsdCents from metadata for INR PaymentIntents", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    // INR PI: amount is 85000 paise (₹850), but originalUsdCents = 1000 ($10)
    await handlePaymentIntentSucceeded(
      makePaymentIntent({
        amount: 85000,
        metadata: { userId: "user-in", originalUsdCents: "1000" },
      } as Partial<Stripe.PaymentIntent>)
    );

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // Should credit $10 (1000 cents / 100), NOT ₹850
    expect(Number(data["amount"])).toBe(10);
  });

  it("stores paymentIntentId as stripeSessionId for idempotency", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handlePaymentIntentSucceeded(
      makePaymentIntent({ id: "pi_unique_999" })
    );

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["stripeSessionId"]).toBe("pi_unique_999");
  });

  it("builds the hash chain: computeHash called once for DEPOSIT", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    const fakePrevHash = "f".repeat(64);
    const fakeDepositHash = "e".repeat(64);
    mockGetLastHash.mockResolvedValueOnce(fakePrevHash);
    mockComputeHash.mockReturnValueOnce(fakeDepositHash);

    await handlePaymentIntentSucceeded(makePaymentIntent());

    expect(mockComputeHash).toHaveBeenCalledTimes(1);

    const [prevArg, typeArg, , userIdArg] = mockComputeHash.mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(prevArg).toBe(fakePrevHash);
    expect(typeArg).toBe("DEPOSIT");
    expect(userIdArg).toBe("user-456");

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["prevHash"]).toBe(fakePrevHash);
    expect(data["txHash"]).toBe(fakeDepositHash);
  });

  // -------------------------------------------------------------------------
  // Idempotency — the core correctness requirement
  // -------------------------------------------------------------------------

  it("is idempotent — second call with same id does NOT insert another row", async () => {
    // First call: payment not yet in DB → inserts DEPOSIT
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    await handlePaymentIntentSucceeded(makePaymentIntent());
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxCreate).toHaveBeenCalledTimes(1);

    // Second call with the same payment: already processed
    mockTransactionFindFirst.mockResolvedValueOnce({ id: "existing-tx-id" });
    await handlePaymentIntentSucceeded(makePaymentIntent());

    // $transaction must NOT have been called a second time
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxCreate).toHaveBeenCalledTimes(1);
  });

  it("does not throw on duplicate delivery — returns cleanly", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce({ id: "already-done" });
    await expect(
      handlePaymentIntentSucceeded(makePaymentIntent())
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it("throws when metadata.userId is missing", async () => {
    const pi = makePaymentIntent({ metadata: {} });
    await expect(handlePaymentIntentSucceeded(pi)).rejects.toThrow(
      "metadata.userId"
    );
    // Should not have touched the DB at all
    expect(mockTransactionFindFirst).not.toHaveBeenCalled();
  });

  it("propagates Prisma errors from the $transaction block", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    mockPrismaTransaction.mockRejectedValueOnce(new Error("DB connection lost"));
    await expect(
      handlePaymentIntentSucceeded(makePaymentIntent())
    ).rejects.toThrow("DB connection lost");
  });
});
