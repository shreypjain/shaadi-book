/**
 * Concurrent Purchases Integration Test — Task 6.1
 *
 * Load test verifying the purchase engine's race-condition safety under
 * simultaneous buy pressure on the same market.
 *
 * Scenario:
 *  1. Create one binary market.
 *  2. Seed 10 users each with a $50 deposit.
 *  3. All 10 users fire buyShares() simultaneously via Promise.all.
 *  4. Assertions:
 *     a. All 10 purchases succeed (no uncaught errors).
 *     b. No race conditions: outcomes.shares_sold equals the arithmetic sum of
 *        individual share results.
 *     c. Reconciliation invariant holds: lhs === rhs within $0.001.
 *     d. All 10 purchase rows exist in the purchases table.
 *     e. Each user's balance is reduced by exactly the purchase cost.
 *
 * Race-safety mechanism:
 *  - buyShares uses SERIALIZABLE isolation + SELECT … FOR UPDATE on outcome rows.
 *  - Concurrent writers queue at the DB lock; each sees the post-commit state
 *    of the preceding writer's LMSR calculation. No phantom reads or write skew.
 *
 * DB strategy:
 *  - TRUNCATE all tables in beforeAll (row-level INSERT-only triggers do not
 *    fire on TRUNCATE in PostgreSQL).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { appendTransaction, runReconciliation } from "../../services/ledger.js";
import {
  createMarket,
  getMarketWithPrices,
} from "../../services/marketService.js";
import { buyShares } from "../../services/purchaseEngine.js";
import { getUserBalance } from "../../services/balance.js";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

const NUM_USERS = 10;
const DEPOSIT_CENTS = 5000; // $50 each
const BUY_CENTS = 2000; // $20 each

let adminId: string;
let marketId: string;
let yesOutcomeId: string;
let userIds: string[] = [];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  process.env["JWT_SECRET"] =
    "concurrent-test-secret-64-chars-long-enough-for-hs256-algorithm";

  // TRUNCATE bypasses FOR-EACH-ROW triggers (only UPDATE/DELETE fire them)
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       admin_audit_logs,
       withdrawal_requests,
       positions,
       purchases,
       transactions,
       outcomes,
       markets,
       users
     RESTART IDENTITY CASCADE`
  );

  // Create admin
  const admin = await prisma.user.create({
    data: { name: "Concurrent Admin", phone: "+15550010000", country: "US", role: "ADMIN" },
  });
  adminId = admin.id;

  // Create 10 guest users and fund them
  userIds = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const user = await prisma.user.create({
      data: {
        name: `Concurrent User ${i}`,
        phone: `+1555001000${i.toString().padStart(1, "0")}`,
        country: "US",
        role: "GUEST",
      },
    });
    userIds.push(user.id);

    // Deposit $50 for each user
    await appendTransaction({
      userId: user.id,
      debitAccount: "stripe",
      creditAccount: `user:${user.id}`,
      type: "DEPOSIT",
      amount: DEPOSIT_CENTS / 100, // $50
    });
  }

  // Create the market
  marketId = await createMarket(adminId, "Concurrent test market", ["Yes", "No"]);

  const market = await getMarketWithPrices(marketId);
  const sorted = [...market!.outcomes].sort((a, b) => a.position - b.position);
  yesOutcomeId = sorted[0]!.id;
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env["JWT_SECRET"];
});

// ---------------------------------------------------------------------------
// The concurrent load test
// ---------------------------------------------------------------------------

describe("Concurrent purchases — 10 simultaneous buyers on the same market", () => {
  // Capture all results once; subsequent tests inspect the captured state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let results: Array<{ userId: string; shares: number; cost: number } | { userId: string; error: unknown }>;

  it("all 10 purchases settle without unhandled rejections", async () => {
    // Fire all purchases simultaneously
    const purchases = userIds.map((userId) =>
      buyShares(userId, marketId, yesOutcomeId, BUY_CENTS)
        .then((r) => ({ userId, shares: r.shares, cost: r.costCents / 100 }))
        .catch((error: unknown) => ({ userId, error }))
    );

    results = await Promise.all(purchases);

    // All settled (no unhandled rejections — Promise.all resolves even on mapped errors)
    expect(results).toHaveLength(NUM_USERS);

    // Count successes
    const successes = results.filter((r) => "shares" in r);
    const failures = results.filter((r) => "error" in r);

    // Log any unexpected failures
    if (failures.length > 0) {
      failures.forEach((f) => {
        if ("error" in f) {
          console.warn(`Purchase failed for user ${f.userId}:`, f.error);
        }
      });
    }

    // All 10 should succeed — SERIALIZABLE + FOR UPDATE serializes them cleanly
    expect(successes.length).toBe(NUM_USERS);
  }, 60_000);

  it("total shares_sold on outcomes table equals sum of individual results", async () => {
    const successResults = results.filter(
      (r): r is { userId: string; shares: number; cost: number } => "shares" in r
    );

    const sumFromResults = successResults.reduce((sum, r) => sum + r.shares, 0);

    const outcome = await prisma.outcome.findUnique({
      where: { id: yesOutcomeId },
      select: { sharesSold: true },
    });
    const sharesSoldInDB = Number(outcome!.sharesSold);

    // Allow floating-point tolerance (4 decimal places)
    expect(Math.abs(sharesSoldInDB - sumFromResults)).toBeLessThan(0.001);
  });

  it("each user has exactly 10 purchase rows (one per buy) — 10 rows total", async () => {
    const count = await prisma.purchase.count({
      where: {
        marketId,
        outcomeId: yesOutcomeId,
      },
    });
    expect(count).toBe(NUM_USERS);
  });

  it("each user's balance decreased by exactly the purchase cost", async () => {
    const depositDollars = DEPOSIT_CENTS / 100;
    const buyDollars = BUY_CENTS / 100;
    const expectedBalanceCents = (depositDollars - buyDollars) * 100;

    for (const userId of userIds) {
      const balanceCents = await getUserBalance(userId);
      expect(balanceCents).toBe(expectedBalanceCents);
    }
  });

  it("each user has exactly one position on Yes after buying", async () => {
    for (const userId of userIds) {
      const pos = await prisma.position.findUnique({
        where: {
          userId_marketId_outcomeId: {
            userId,
            marketId,
            outcomeId: yesOutcomeId,
          },
        },
      });
      expect(pos).not.toBeNull();
      expect(Number(pos!.totalCost)).toBeCloseTo(BUY_CENTS / 100, 4);
    }
  });

  it("reconciliation invariant holds after all 10 concurrent purchases", async () => {
    const recon = await runReconciliation();

    expect(recon.isBalanced).toBe(true);
    expect(recon.housePool.greaterThanOrEqualTo(0)).toBe(true);

    // Total house pool = total purchased (since no resolution yet)
    const totalBought = (NUM_USERS * BUY_CENTS) / 100; // $200
    // housePool ≈ totalBought (minor floating-point variance OK)
    const diff = Math.abs(recon.housePool.toNumber() - totalBought);
    expect(diff).toBeLessThan(0.001);
  });

  it("no duplicate positions — each user has at most one position per outcome", async () => {
    const positions = await prisma.position.findMany({
      where: { marketId, outcomeId: yesOutcomeId },
    });
    // Should be exactly NUM_USERS positions
    expect(positions).toHaveLength(NUM_USERS);

    // All user IDs are distinct
    const uniqueUserIds = new Set(positions.map((p) => p.userId));
    expect(uniqueUserIds.size).toBe(NUM_USERS);
  });

  it("transaction table has correct entry count (10 deposits + 10 purchases = 20)", async () => {
    const total = await prisma.transaction.count();
    expect(total).toBe(NUM_USERS + NUM_USERS); // 10 DEPOSIT + 10 PURCHASE
  });

  it("hash chain linkage is intact after concurrent insertions", async () => {
    const txs = await prisma.transaction.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, prevHash: true, txHash: true },
    });

    expect(txs.length).toBe(NUM_USERS * 2);

    // First tx must reference genesis hash
    expect(txs[0]!.prevHash).toBe("0".repeat(64));

    // Each tx must reference the preceding tx's hash
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i]!.prevHash).toBe(txs[i - 1]!.txHash);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases — independent of the concurrent load scenario above
// ---------------------------------------------------------------------------

describe("Concurrent safety edge cases", () => {
  it("prices sum to 1.0 after all concurrent Yes buys", async () => {
    const market = await getMarketWithPrices(marketId);
    const total = market!.outcomes.reduce((sum, o) => sum + o.price, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.0001);
  });

  it("Yes price increased substantially after 10 × $20 buys", async () => {
    const market = await getMarketWithPrices(marketId);
    const yes = market!.outcomes.find((o) => o.id === yesOutcomeId)!;
    // After $200 total on Yes, the price should have moved significantly above 50¢
    expect(yes.price).toBeGreaterThan(0.5);
  });

  it("$200 cap is not exceeded — each user only bought $20 in this market", async () => {
    for (const userId of userIds) {
      const spendResult = await prisma.$queryRaw<Array<{ total_spend: unknown }>>`
        SELECT COALESCE(SUM(cost), 0) AS total_spend
        FROM purchases
        WHERE user_id = ${userId}::uuid
          AND market_id = ${marketId}::uuid
      `;
      const spent = Number(
        (spendResult[0] as { total_spend: unknown })?.total_spend ?? 0
      );
      expect(spent).toBeLessThanOrEqual(200);
    }
  });
});
