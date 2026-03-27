/**
 * Stripe service tests — Task 3.1
 *
 * Coverage:
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
 *     - inserts DEPOSIT transaction for a new session
 *     - credits the correct user with the correct amount (cents → dollars)
 *     - uses correct double-entry accounts (debit: stripe, credit: user:{id})
 *     - stores stripeSessionId on the row for future idempotency lookups
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

import { createDepositSession, handleCheckoutCompleted } from "../stripe.js";

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
  it("inserts a DEPOSIT transaction for a new (unprocessed) session", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession());

    // Idempotency check was performed with the correct session ID
    expect(mockTransactionFindFirst).toHaveBeenCalledWith({
      where: { stripeSessionId: "cs_test_abc123" },
      select: { id: true },
    });

    // The Prisma transaction was started
    expect(mockPrismaTransaction).toHaveBeenCalledOnce();

    // A transaction row was created
    expect(mockTxCreate).toHaveBeenCalledOnce();
    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["type"]).toBe("DEPOSIT");
    expect(data["userId"]).toBe("user-456");
    expect(data["stripeSessionId"]).toBe("cs_test_abc123");
  });

  it("uses correct double-entry accounts (debit: stripe, credit: user:{id})", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession());

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["debitAccount"]).toBe("stripe");
    expect(data["creditAccount"]).toBe("user:user-456");
  });

  it("converts amountCents to dollars (2500 cents → 25)", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession({ amount_total: 2500 }));

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // Decimal(2500).div(100) == 25
    expect(Number(data["amount"])).toBe(25);
  });

  it("stores stripeSessionId on the row for future idempotency checks", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);

    await handleCheckoutCompleted(makeSession({ id: "cs_unique_999" }));

    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["stripeSessionId"]).toBe("cs_unique_999");
  });

  it("builds the hash chain: calls getLastHash then computeHash with correct args", async () => {
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    const fakePrevHash = "f".repeat(64);
    const fakeTxHash = "e".repeat(64);
    mockGetLastHash.mockResolvedValueOnce(fakePrevHash);
    mockComputeHash.mockReturnValueOnce(fakeTxHash);

    await handleCheckoutCompleted(makeSession());

    // computeHash called with: prevHash, type='DEPOSIT', amount string, userId
    expect(mockComputeHash).toHaveBeenCalledOnce();
    const [prevArg, typeArg, , userIdArg] = mockComputeHash.mock.calls[0] as [
      string,
      string,
      string,
      string
    ];
    expect(prevArg).toBe(fakePrevHash);
    expect(typeArg).toBe("DEPOSIT");
    expect(userIdArg).toBe("user-456");

    // Both hashes land on the created row
    const { data } = mockTxCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data["prevHash"]).toBe(fakePrevHash);
    expect(data["txHash"]).toBe(fakeTxHash);
  });

  // -------------------------------------------------------------------------
  // Idempotency — the core correctness requirement
  // -------------------------------------------------------------------------

  it("is idempotent — second call with same session does NOT insert another row", async () => {
    // First call: session not yet in DB
    mockTransactionFindFirst.mockResolvedValueOnce(null);
    await handleCheckoutCompleted(makeSession());
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxCreate).toHaveBeenCalledTimes(1);

    // Second call with the same session: already processed
    mockTransactionFindFirst.mockResolvedValueOnce({ id: "existing-tx-id" });
    await handleCheckoutCompleted(makeSession());

    // $transaction must NOT have been called a second time
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    // tx.transaction.create must still only have been called once in total
    expect(mockTxCreate).toHaveBeenCalledTimes(1);
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
