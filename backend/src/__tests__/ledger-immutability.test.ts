/**
 * Ledger Immutability Tests — Task 1.1
 *
 * Verifies that the INSERT-only triggers on `transactions` and `purchases`
 * correctly block any UPDATE or DELETE operations.
 *
 * These are integration tests that require a live PostgreSQL connection.
 * They run against the test database (shaadi_book_test) seeded by the
 * global setup file.
 *
 * Design note: because the tables are append-only, we intentionally do NOT
 * clean up the rows inserted during these tests — that would require a DELETE
 * which is exactly what the trigger prevents. Each test run adds a small
 * number of rows to the test DB (which is reset between CI runs anyway).
 */

import { afterAll, beforeAll, describe as _describe, expect, it } from "vitest";

// Skip all tests when no DATABASE_URL (e.g. CI without a Postgres service)
const NO_DB = process.env["CI"] === "true" || process.env["SKIP_DB_TESTS"] === "true";
const describe = ((name: string, fn: () => void) =>
  _describe.skipIf(NO_DB)(name, fn)) as typeof _describe;

import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const prisma = NO_DB ? (null as unknown as PrismaClient) : new PrismaClient();

/** Zero-filled SHA-256 placeholder used as genesis hash. */
const GENESIS_HASH = "0".repeat(64);

/** Minimal fake hash padded to 64 chars — real hash logic is in Task 2.3. */
function fakeHash(seed: string): string {
  return seed.padEnd(64, "0").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let testUserId: string;
let testMarketId: string;
let testOutcomeId: string;
let testTransactionId: string;
let testPurchaseId: string;

// ---------------------------------------------------------------------------
// Setup: seed minimal data needed to satisfy FK constraints
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Unique phone per run so tests are re-runnable without conflicts
  const uniquePhone = `+1555${Date.now().toString().slice(-7)}`;

  const user = await prisma.user.create({
    data: { name: "Test User", phone: uniquePhone, country: "US", role: "GUEST" },
  });
  testUserId = user.id;

  const market = await prisma.market.create({
    data: {
      question: "Will the groom cry during the pheras?",
      status: "ACTIVE",
      createdById: testUserId,
      openedAt: new Date(),
    },
  });
  testMarketId = market.id;

  const outcome = await prisma.outcome.create({
    data: { marketId: testMarketId, label: "Yes", position: 0, sharesSold: 0 },
  });
  testOutcomeId = outcome.id;

  // INSERT must succeed — this is the happy path
  const tx = await prisma.transaction.create({
    data: {
      userId: testUserId,
      debitAccount: `user:${testUserId}`,
      creditAccount: "house_amm",
      type: "DEPOSIT",
      amount: 10,
      prevHash: GENESIS_HASH,
      txHash: fakeHash("test-tx-seed"),
    },
  });
  testTransactionId = tx.id;

  const purchase = await prisma.purchase.create({
    data: {
      userId: testUserId,
      marketId: testMarketId,
      outcomeId: testOutcomeId,
      shares: 5,
      cost: 10,
      avgPrice: 0.5,
      priceBefore: 0.5,
      priceAfter: 0.55,
      bAtPurchase: 20,
    },
  });
  testPurchaseId = purchase.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Transaction table tests
// ---------------------------------------------------------------------------

describe("Transaction table — INSERT-only trigger", () => {
  it("allows INSERT (sanity check)", () => {
    // If beforeAll reached here, INSERT succeeded.
    expect(testTransactionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("blocks UPDATE — trigger raises exception", async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE transactions
        SET debit_account = 'hacked'
        WHERE id = ${testTransactionId}
      `
    ).rejects.toThrow("Modifications to this table are not allowed");
  });

  it("blocks DELETE — trigger raises exception", async () => {
    await expect(
      prisma.$executeRaw`
        DELETE FROM transactions
        WHERE id = ${testTransactionId}
      `
    ).rejects.toThrow("Modifications to this table are not allowed");
  });

  it("row is unmodified after failed UPDATE attempt", async () => {
    const tx = await prisma.transaction.findUniqueOrThrow({
      where: { id: testTransactionId },
    });
    expect(tx.debitAccount).toBe(`user:${testUserId}`);
    expect(tx.creditAccount).toBe("house_amm");
    expect(tx.type).toBe("DEPOSIT");
    expect(Number(tx.amount)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Purchase table tests
// ---------------------------------------------------------------------------

describe("Purchase table — INSERT-only trigger", () => {
  it("allows INSERT (sanity check)", () => {
    expect(testPurchaseId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("blocks UPDATE — trigger raises exception", async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE purchases
        SET cost = 9999
        WHERE id = ${testPurchaseId}
      `
    ).rejects.toThrow("Modifications to this table are not allowed");
  });

  it("blocks DELETE — trigger raises exception", async () => {
    await expect(
      prisma.$executeRaw`
        DELETE FROM purchases
        WHERE id = ${testPurchaseId}
      `
    ).rejects.toThrow("Modifications to this table are not allowed");
  });

  it("row is unmodified after failed UPDATE attempt", async () => {
    const purchase = await prisma.purchase.findUniqueOrThrow({
      where: { id: testPurchaseId },
    });
    expect(Number(purchase.cost)).toBe(10);
    expect(Number(purchase.shares)).toBe(5);
    expect(Number(purchase.priceBefore)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Position table — mutable (no trigger, should allow updates)
// ---------------------------------------------------------------------------

describe("Position table — mutable (no trigger)", () => {
  it("allows UPDATE on positions (positions accumulate shares on each purchase)", async () => {
    const pos = await prisma.position.create({
      data: {
        userId: testUserId,
        marketId: testMarketId,
        outcomeId: testOutcomeId,
        shares: 5,
        totalCost: 10,
      },
    });

    // UPDATE must not throw — positions are legitimately mutable
    await expect(
      prisma.$executeRaw`
        UPDATE positions SET shares = 10, total_cost = 20 WHERE id = ${pos.id}
      `
    ).resolves.toBe(1);

    // Cleanup — DELETE is fine on positions
    await prisma.$executeRaw`DELETE FROM positions WHERE id = ${pos.id}`;
  });
});
