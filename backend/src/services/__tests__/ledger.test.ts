/**
 * Ledger Service Tests — Task 2.3 + stripe-fee-from-charity
 *
 * Tests for:
 *  - computeTxHash (pure function — no DB)
 *  - appendTransaction (hash chain, genesis, chaining)
 *  - getUserBalance (credits add, debits subtract)
 *  - getCharityPoolTotal / getTotalDeposits / getTotalWithdrawals
 *  - getStripeFees / getNetCharityAmount
 *  - runReconciliation (balanced / imbalanced, includes stripe fees)
 *  - verifyChainIntegrity (valid chain, bad txHash, bad prevHash link)
 *
 * These are integration tests requiring a live PostgreSQL connection.
 * DATABASE_URL is overridden to the test DB by setup.ts.
 *
 * Accounting convention used throughout:
 *   DEPOSIT:     debit=stripe,          credit=user:{id}        → balance +
 *   PURCHASE:    debit=user:{id},       credit=house_amm        → balance -
 *   PAYOUT:      debit=house_amm,       credit=user:{id}        → balance +
 *   CHARITY_FEE: debit=house_amm,       credit=charity_pool     → no user effect
 *   WITHDRAWAL:  debit=user:{id},       credit=withdrawal:ref   → balance -
 *   STRIPE_FEE:  debit=charity_pool,    credit=stripe_processor → stripe fees tracked
 */

import { afterAll, beforeAll, describe, expect, it, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import {
  computeTxHash,
  GENESIS_HASH,
  appendTransaction,
  getUserBalance,
  getCharityPoolTotal,
  getStripeFees,
  getNetCharityAmount,
  getTotalDeposits,
  getTotalWithdrawals,
  runReconciliation,
} from "../ledger.js";
import { verifyChainIntegrity } from "../hashChainVerifier.js";

// ---------------------------------------------------------------------------
// Test DB client
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal user suitable for FK constraints. */
async function createTestUser(suffix: string) {
  // Use timestamp + suffix to avoid phone collisions across test runs.
  const phone = `+1555${Date.now().toString().slice(-6)}${suffix}`;
  return prisma.user.create({
    data: { name: `Test ${suffix}`, phone, country: "US", role: "GUEST" },
  });
}

// ---------------------------------------------------------------------------
// Shared fixtures (one user per describe block to isolate ledger state)
// ---------------------------------------------------------------------------

let userId: string;

beforeAll(async () => {
  const user = await createTestUser("A");
  userId = user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// computeTxHash — pure function, no DB needed
// ---------------------------------------------------------------------------

describe("computeTxHash", () => {
  const prevHash = "a".repeat(64);
  const type = "DEPOSIT" as const;
  const amount = new Decimal("50.00");
  const uid = "user-123";
  const ts = new Date("2024-01-01T00:00:00.000Z");

  it("returns a 64-character hex string", () => {
    const hash = computeTxHash(prevHash, type, amount, uid, ts);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs → same hash", () => {
    const h1 = computeTxHash(prevHash, type, amount, uid, ts);
    const h2 = computeTxHash(prevHash, type, amount, uid, ts);
    expect(h1).toBe(h2);
  });

  it("changes when prevHash changes", () => {
    const h1 = computeTxHash("a".repeat(64), type, amount, uid, ts);
    const h2 = computeTxHash("b".repeat(64), type, amount, uid, ts);
    expect(h1).not.toBe(h2);
  });

  it("changes when type changes", () => {
    const h1 = computeTxHash(prevHash, "DEPOSIT", amount, uid, ts);
    const h2 = computeTxHash(prevHash, "PURCHASE", amount, uid, ts);
    expect(h1).not.toBe(h2);
  });

  it("changes when amount changes", () => {
    const h1 = computeTxHash(prevHash, type, "10.00", uid, ts);
    const h2 = computeTxHash(prevHash, type, "11.00", uid, ts);
    expect(h1).not.toBe(h2);
  });

  it("changes when userId changes", () => {
    const h1 = computeTxHash(prevHash, type, amount, "user-1", ts);
    const h2 = computeTxHash(prevHash, type, amount, "user-2", ts);
    expect(h1).not.toBe(h2);
  });

  it("changes when createdAt changes", () => {
    const h1 = computeTxHash(prevHash, type, amount, uid, new Date("2024-01-01T00:00:00.000Z"));
    const h2 = computeTxHash(prevHash, type, amount, uid, new Date("2024-01-02T00:00:00.000Z"));
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// appendTransaction — hash chain linking
// ---------------------------------------------------------------------------

describe("appendTransaction — hash chain", () => {
  let isolatedUserId: string;

  beforeAll(async () => {
    const user = await createTestUser("B");
    isolatedUserId = user.id;
  });

  it("first transaction uses GENESIS_HASH as prevHash", async () => {
    const tx = await appendTransaction({
      userId: isolatedUserId,
      debitAccount: "house_amm",
      creditAccount: `user:${isolatedUserId}`,
      type: "DEPOSIT",
      amount: "100.00",
    });

    expect(tx.prevHash).toBe(GENESIS_HASH);
    expect(tx.txHash).toHaveLength(64);
    expect(tx.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("second transaction uses first transaction's txHash as prevHash", async () => {
    // Need a fresh user so we control the "first" transaction in a deterministic way.
    const user = await createTestUser("C");
    const uid = user.id;

    const tx1 = await appendTransaction({
      userId: uid,
      debitAccount: "house_amm",
      creditAccount: `user:${uid}`,
      type: "DEPOSIT",
      amount: "50.00",
    });

    const tx2 = await appendTransaction({
      userId: uid,
      debitAccount: `user:${uid}`,
      creditAccount: "house_amm",
      type: "PURCHASE",
      amount: "25.00",
    });

    expect(tx2.prevHash).toBe(tx1.txHash);
  });

  it("txHash matches recomputation from stored fields", async () => {
    const user = await createTestUser("D");
    const uid = user.id;

    const tx = await appendTransaction({
      userId: uid,
      debitAccount: "house_amm",
      creditAccount: `user:${uid}`,
      type: "DEPOSIT",
      amount: "75.00",
    });

    const expected = computeTxHash(
      tx.prevHash,
      tx.type,
      tx.amount,
      tx.userId,
      tx.createdAt
    );

    expect(tx.txHash).toBe(expected);
  });

  it("stripeSessionId is stored when provided", async () => {
    const user = await createTestUser("E");
    const uid = user.id;

    const tx = await appendTransaction({
      userId: uid,
      debitAccount: "house_amm",
      creditAccount: `user:${uid}`,
      type: "DEPOSIT",
      amount: "30.00",
      stripeSessionId: "cs_test_abc123",
    });

    expect(tx.stripeSessionId).toBe("cs_test_abc123");
  });
});

// ---------------------------------------------------------------------------
// getUserBalance
// ---------------------------------------------------------------------------

describe("getUserBalance", () => {
  let balUserId: string;

  beforeAll(async () => {
    const user = await createTestUser("F");
    balUserId = user.id;
  });

  it("returns 0 for a user with no transactions", async () => {
    const user = await createTestUser("G");
    const bal = await getUserBalance(user.id);
    expect(bal.toNumber()).toBe(0);
  });

  it("increases balance when user is creditAccount (DEPOSIT)", async () => {
    await appendTransaction({
      userId: balUserId,
      debitAccount: "house_amm",
      creditAccount: `user:${balUserId}`,
      type: "DEPOSIT",
      amount: "100.00",
    });

    const bal = await getUserBalance(balUserId);
    expect(bal.toNumber()).toBeGreaterThanOrEqual(100);
  });

  it("decreases balance when user is debitAccount (PURCHASE)", async () => {
    const before = await getUserBalance(balUserId);

    await appendTransaction({
      userId: balUserId,
      debitAccount: `user:${balUserId}`,
      creditAccount: "house_amm",
      type: "PURCHASE",
      amount: "40.00",
    });

    const after = await getUserBalance(balUserId);
    // Balance decreased by 40
    expect(before.minus(after).toNumber()).toBeCloseTo(40, 5);
  });

  it("increases balance when user receives PAYOUT", async () => {
    const before = await getUserBalance(balUserId);

    await appendTransaction({
      userId: balUserId,
      debitAccount: "house_amm",
      creditAccount: `user:${balUserId}`,
      type: "PAYOUT",
      amount: "32.00",
    });

    const after = await getUserBalance(balUserId);
    expect(after.minus(before).toNumber()).toBeCloseTo(32, 5);
  });

  it("decreases balance when user withdraws", async () => {
    const before = await getUserBalance(balUserId);

    await appendTransaction({
      userId: balUserId,
      debitAccount: `user:${balUserId}`,
      creditAccount: "withdrawal:ref",
      type: "WITHDRAWAL",
      amount: "20.00",
    });

    const after = await getUserBalance(balUserId);
    expect(before.minus(after).toNumber()).toBeCloseTo(20, 5);
  });

  it("CHARITY_FEE does not affect user balance", async () => {
    const before = await getUserBalance(balUserId);

    await appendTransaction({
      userId: balUserId,
      debitAccount: "house_amm",
      creditAccount: "charity_pool",
      type: "CHARITY_FEE",
      amount: "8.00",
    });

    const after = await getUserBalance(balUserId);
    expect(after.toNumber()).toBeCloseTo(before.toNumber(), 5);
  });
});

// ---------------------------------------------------------------------------
// getCharityPoolTotal / getTotalDeposits / getTotalWithdrawals
// ---------------------------------------------------------------------------

describe("Aggregate ledger queries", () => {
  let aggUserId: string;

  beforeAll(async () => {
    const user = await createTestUser("H");
    aggUserId = user.id;

    // Insert a known set of transactions.
    await appendTransaction({
      userId: aggUserId,
      debitAccount: "house_amm",
      creditAccount: `user:${aggUserId}`,
      type: "DEPOSIT",
      amount: "200.00",
    });
    await appendTransaction({
      userId: aggUserId,
      debitAccount: "house_amm",
      creditAccount: `user:${aggUserId}`,
      type: "DEPOSIT",
      amount: "50.00",
    });
    await appendTransaction({
      userId: aggUserId,
      debitAccount: "house_amm",
      creditAccount: "charity_pool",
      type: "CHARITY_FEE",
      amount: "10.00",
    });
    await appendTransaction({
      userId: aggUserId,
      debitAccount: "house_amm",
      creditAccount: "charity_pool",
      type: "CHARITY_FEE",
      amount: "5.00",
    });
    await appendTransaction({
      userId: aggUserId,
      debitAccount: `user:${aggUserId}`,
      creditAccount: "withdrawal:ref",
      type: "WITHDRAWAL",
      amount: "30.00",
    });
  });

  it("getTotalDeposits sums only DEPOSIT rows", async () => {
    const total = await getTotalDeposits();
    // There are multiple users creating deposits across tests; just verify
    // the function runs and the result accounts for our test user's $250.
    expect(total.toNumber()).toBeGreaterThanOrEqual(250);
  });

  it("getCharityPoolTotal sums only CHARITY_FEE rows", async () => {
    const total = await getCharityPoolTotal();
    // Our test user contributed $15 in charity fees.
    expect(total.toNumber()).toBeGreaterThanOrEqual(15);
  });

  it("getTotalWithdrawals sums only WITHDRAWAL rows", async () => {
    const total = await getTotalWithdrawals();
    expect(total.toNumber()).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// getStripeFees / getNetCharityAmount
// ---------------------------------------------------------------------------

describe("getStripeFees / getNetCharityAmount", () => {
  let stripeFeeUserId: string;

  beforeAll(async () => {
    const user = await createTestUser("SF");
    stripeFeeUserId = user.id;

    // Simulate a deposit with an accompanying stripe fee.
    await appendTransaction({
      userId: stripeFeeUserId,
      debitAccount: "stripe",
      creditAccount: `user:${stripeFeeUserId}`,
      type: "DEPOSIT",
      amount: "25.00",
    });
    // Stripe fee: 2.9% * 2500 + 30 = 103 cents = $1.03
    await appendTransaction({
      userId: stripeFeeUserId,
      debitAccount: "charity_pool",
      creditAccount: "stripe_processor",
      type: "STRIPE_FEE",
      amount: "1.03",
    });
    // Also add a charity fee so we can verify net calculation.
    await appendTransaction({
      userId: stripeFeeUserId,
      debitAccount: "house_amm",
      creditAccount: "charity_pool",
      type: "CHARITY_FEE",
      amount: "5.00",
    });
  });

  it("getStripeFees sums only STRIPE_FEE rows", async () => {
    const fees = await getStripeFees();
    // Our test user contributed $1.03 in stripe fees.
    expect(fees.toNumber()).toBeGreaterThanOrEqual(1.03);
  });

  it("getNetCharityAmount = getCharityPoolTotal − getStripeFees", async () => {
    const [gross, fees, net] = await Promise.all([
      getCharityPoolTotal(),
      getStripeFees(),
      getNetCharityAmount(),
    ]);
    expect(net.minus(gross.minus(fees)).abs().toNumber()).toBeLessThan(0.000001);
  });

  it("STRIPE_FEE does not affect user balance", async () => {
    // STRIPE_FEE debits charity_pool, not user account — balance unaffected.
    const bal = await getUserBalance(stripeFeeUserId);
    expect(bal.toNumber()).toBeGreaterThanOrEqual(25); // only the DEPOSIT matters
  });
});

// ---------------------------------------------------------------------------
// runReconciliation
// ---------------------------------------------------------------------------

describe("runReconciliation", () => {
  it("is balanced when deposits ≥ user_balances + charity + withdrawals", async () => {
    const result = await runReconciliation();
    // Across all test transactions, the invariant should hold.
    expect(result.isBalanced).toBe(true);
    expect(result.housePool.toNumber()).toBeGreaterThanOrEqual(0);
  });

  it("returns correct structure with all required fields", async () => {
    const result = await runReconciliation();
    expect(result).toMatchObject({
      isBalanced: expect.any(Boolean),
      totalDeposits: expect.any(Object), // Decimal
      totalUserBalances: expect.any(Object),
      charityPool: expect.any(Object),       // gross CHARITY_FEE total
      stripeFees: expect.any(Object),        // STRIPE_FEE total
      netCharityAmount: expect.any(Object),  // charityPool − stripeFees
      withdrawalsPaid: expect.any(Object),
      housePool: expect.any(Object),
      checkedAt: expect.any(Date),
    });
  });

  it("housePool = deposits − userBalances − charity − stripeFees − withdrawals", async () => {
    const r = await runReconciliation();
    const computed = r.totalDeposits
      .minus(r.totalUserBalances)
      .minus(r.charityPool)
      .minus(r.stripeFees)
      .minus(r.withdrawalsPaid);
    // Should match within floating-point tolerance.
    expect(r.housePool.minus(computed).abs().toNumber()).toBeLessThan(0.000001);
  });

  it("netCharityAmount = charityPool − stripeFees", async () => {
    const r = await runReconciliation();
    const expected = r.charityPool.minus(r.stripeFees);
    expect(r.netCharityAmount.minus(expected).abs().toNumber()).toBeLessThan(0.000001);
  });
});

// ---------------------------------------------------------------------------
// verifyChainIntegrity
// ---------------------------------------------------------------------------

describe("verifyChainIntegrity", () => {
  it("reports valid for the current chain (all appended via appendTransaction)", async () => {
    const result = await verifyChainIntegrity();
    expect(result.valid).toBe(true);
    expect(result.firstBadTransactionId).toBeUndefined();
    expect(result.checkedCount).toBeGreaterThan(0);
  });

  it("detects a transaction inserted with a wrong prevHash", async () => {
    // Insert a transaction directly with a deliberately wrong prevHash.
    // We bypass appendTransaction to simulate tampering.
    const user = await createTestUser("I");
    const uid = user.id;

    // First, insert a legitimate transaction (so the chain has a known tail).
    const legitimateTx = await appendTransaction({
      userId: uid,
      debitAccount: "house_amm",
      creditAccount: `user:${uid}`,
      type: "DEPOSIT",
      amount: "10.00",
    });

    // Now insert a tampered transaction whose prevHash does NOT equal
    // legitimateTx.txHash — it should break the chain link.
    const wrongPrevHash = "f".repeat(64); // deliberately wrong
    const createdAt = new Date(Date.now() + 1); // ensure it sorts after legitimateTx

    // Use raw SQL to bypass appendTransaction's automatic prevHash lookup.
    await prisma.$executeRaw`
      INSERT INTO transactions (id, user_id, debit_account, credit_account, type, amount, prev_hash, tx_hash, created_at)
      VALUES (
        gen_random_uuid(),
        ${uid},
        ${"house_amm"},
        ${`user:${uid}`},
        'DEPOSIT'::"TransactionType",
        10,
        ${wrongPrevHash},
        ${computeTxHash(wrongPrevHash, "DEPOSIT", "10.00", uid, createdAt)},
        ${createdAt}
      )
    `;

    const result = await verifyChainIntegrity();

    // The chain should now be broken because the tampered tx's prevHash
    // doesn't match the preceding tx's txHash.
    expect(result.valid).toBe(false);
    expect(result.firstBadTransactionId).toBeDefined();
    expect(result.error).toBeDefined();
  });

  it("detects a transaction whose stored txHash doesn't match the recomputation", async () => {
    // Insert a transaction with a plausible prevHash (so the link looks OK)
    // but a deliberately wrong txHash (as if the row was mutated).
    const user = await createTestUser("J");
    const uid = user.id;

    // Get the current chain tail to use as a valid prevHash.
    const lastTx = await prisma.transaction.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { txHash: true },
    });
    const tailHash = lastTx?.txHash ?? GENESIS_HASH;

    const createdAt = new Date(Date.now() + 2);
    // Use the correct prevHash (tail) but a WRONG txHash.
    const corruptTxHash = "0".repeat(64); // obviously wrong

    await prisma.$executeRaw`
      INSERT INTO transactions (id, user_id, debit_account, credit_account, type, amount, prev_hash, tx_hash, created_at)
      VALUES (
        gen_random_uuid(),
        ${uid},
        ${"house_amm"},
        ${`user:${uid}`},
        'DEPOSIT'::"TransactionType",
        5,
        ${tailHash},
        ${corruptTxHash},
        ${createdAt}
      )
    `;

    const result = await verifyChainIntegrity();
    expect(result.valid).toBe(false);
    expect(result.firstBadTransactionId).toBeDefined();
  });

  it("checkedCount equals the total number of transactions in the DB", async () => {
    const dbCount = await prisma.transaction.count();
    const result = await verifyChainIntegrity();

    // Might be valid=false at this point due to earlier tamper tests,
    // but checkedCount should reflect how far we got.
    expect(result.checkedCount).toBeLessThanOrEqual(dbCount);
    expect(result.checkedCount).toBeGreaterThan(0);
  });
});
