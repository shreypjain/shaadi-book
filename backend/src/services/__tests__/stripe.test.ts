/**
 * Stripe service tests — PaymentIntent flow
 *
 * Coverage:
 *   estimateStripeFee:
 *     - $25 deposit → correct fee (2.9% + $0.30)
 *     - $10 deposit → correct fee
 *     - $50 deposit → correct fee
 *     - returns integer cents
 *
 *   createPaymentIntent:
 *     - creates PaymentIntent with correct params
 *     - returns clientSecret and paymentIntentId
 *     - throws when STRIPE_SECRET_KEY is missing
 *     - throws when Stripe returns no client_secret
 *     - propagates Stripe API errors
 *
 *   handlePaymentIntentSucceeded:
 *     - inserts a DEPOSIT transaction for a new payment
 *     - DEPOSIT uses correct double-entry accounts
 *     - converts amountCents to dollars
 *     - stores paymentIntentId as stripeSessionId
 *     - is idempotent — second call does NOT insert again
 *     - does not throw on duplicate delivery
 *     - throws when metadata.userId is missing
 *     - propagates Prisma errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

// ---------------------------------------------------------------------------
// vi.hoisted — variables used inside vi.mock factories
// ---------------------------------------------------------------------------

const {
  mockPaymentIntentsCreate,
  mockTransactionFindFirst,
  mockPrismaTransaction,
  mockTxCreate,
  mockGetLastHash,
  mockComputeHash,
} = vi.hoisted(() => ({
  mockPaymentIntentsCreate: vi.fn(),
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
    paymentIntents: { create: mockPaymentIntentsCreate },
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
    amount: 2500,
    metadata: { userId: "user-456" },
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

  // Default hash chain stubs
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
    expect(estimateStripeFee(2500)).toBe(103);
  });

  it("$10 deposit (1000 cents) → 59 cents (2.9% × 1000 + 30 = 59)", () => {
    expect(estimateStripeFee(1000)).toBe(59);
  });

  it("$50 deposit (5000 cents) → 175 cents (2.9% × 5000 + 30 = 175)", () => {
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
      client_secret: "pi_test_123_secret_abc",
    });

    await createPaymentIntent(2500, "user-123");

    expect(mockPaymentIntentsCreate).toHaveBeenCalledOnce();
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith({
      amount: 2500,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { userId: "user-123" },
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

  it("throws when Stripe returns no client_secret", async () => {
    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: "pi_test_nosecret",
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
});

// ---------------------------------------------------------------------------
// handlePaymentIntentSucceeded
// ---------------------------------------------------------------------------

describe("handlePaymentIntentSucceeded", () => {
  it("inserts a DEPOSIT transaction for a new payment", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handlePaymentIntentSucceeded(makePaymentIntent());

    // Idempotency check was performed
    expect(mockTransactionFindFirst).toHaveBeenCalledWith({
      where: { stripeSessionId: "pi_test_abc123" },
      select: { id: true },
    });

    // The Prisma transaction was started
    expect(mockPrismaTransaction).toHaveBeenCalledOnce();

    // One DEPOSIT row inserted (no STRIPE_FEE — house absorbs)
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

  it("converts amountCents to dollars for DEPOSIT (2500 cents → 25)", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handlePaymentIntentSucceeded(makePaymentIntent({ amount: 2500 }));

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(Number(data["amount"])).toBe(25);
  });

  it("stores paymentIntentId as stripeSessionId", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handlePaymentIntentSucceeded(makePaymentIntent({ id: "pi_unique_999" }));

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["stripeSessionId"]).toBe("pi_unique_999");
  });

  it("is idempotent — second call does NOT insert another row", async () => {
    // First call: not yet in DB
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    await handlePaymentIntentSucceeded(makePaymentIntent());
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxCreate).toHaveBeenCalledTimes(1);

    // Second call: already processed
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

  it("throws when metadata.userId is missing", async () => {
    const pi = makePaymentIntent({ metadata: {} } as Partial<Stripe.PaymentIntent>);
    await expect(handlePaymentIntentSucceeded(pi)).rejects.toThrow(
      "userId"
    );
  });

  it("propagates Prisma errors from the $transaction block", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    mockPrismaTransaction.mockRejectedValueOnce(new Error("DB connection lost"));
    await expect(handlePaymentIntentSucceeded(makePaymentIntent())).rejects.toThrow(
      "DB connection lost"
    );
  });
});
