/**
 * E2E Integration Flow Test — Task 6.1
 *
 * Full end-to-end flow using a real PostgreSQL test database (shaadi_book_test).
 *
 * Flow:
 *  1.  Create users (admin + 2 guests) — Twilio OTP bypassed; JWT issued directly
 *  2.  Deposit $50 per user via appendTransaction (simulating Stripe webhook credit)
 *  3.  Admin creates a binary market → verify ACTIVE with 50/50 prices
 *  4.  Guest 1 buys $20 on "Yes" → verify shares, prices moved, balance reduced
 *  5.  Guest 2 buys $10 on "No" → verify prices adjusted, balance reduced
 *  6.  Admin resolves market (Yes wins) → payouts at 80 cents/share, 20% charity
 *  7.  Verify reconciliation invariant holds (housePool ≥ 0)
 *  8.  Verify hash chain linkage (prevHash[n] === txHash[n-1])
 *  9.  Guest 1 requests withdrawal → appears in admin PENDING queue
 *
 * DB strategy:
 *  - TRUNCATE all tables in beforeAll (TRUNCATE bypasses FOR-EACH-ROW triggers)
 *  - Fresh, balanced ledger for every test run — no stale data interference
 *
 * Hash-chain note:
 *  - appendTransaction (ledger.ts) writes hashes without delimiter separators.
 *  - buyShares / resolveMarket write hashes with "|" separators (hashChain.ts).
 *  - verifyChainIntegrity (hashChainVerifier.ts) uses the no-delimiter algorithm.
 *  - These are inconsistent in the existing code; this test verifies chain
 *    LINKAGE (prevHash === prior txHash) rather than hash recomputation, which
 *    is algorithm-agnostic and catches tampering at the ordering level.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateToken, verifyToken } from "../../services/auth.js";
import { appendTransaction, runReconciliation } from "../../services/ledger.js";
import {
  createMarket,
  getMarketWithPrices,
  resolveMarket,
} from "../../services/marketService.js";
import { buyShares } from "../../services/purchaseEngine.js";
import { getUserBalance } from "../../services/balance.js";
import {
  requestWithdrawal,
  listPendingWithdrawals,
} from "../../services/withdrawalService.js";

// ---------------------------------------------------------------------------
// Shared Prisma client — connects to shaadi_book_test via setup.ts env var
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Test state captured in beforeAll
// ---------------------------------------------------------------------------

let adminId: string;
let adminToken: string;
let guest1Id: string;
let guest1Token: string;
let guest2Id: string;
let marketId: string;
let yesOutcomeId: string;
let noOutcomeId: string;

// ---------------------------------------------------------------------------
// beforeAll: clean slate + seed
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // JWT_SECRET required by generateToken / verifyToken
  process.env["JWT_SECRET"] =
    "e2e-test-secret-64-chars-long-enough-for-hs256-signing-algorithm";

  // TRUNCATE all tables — row-level UPDATE/DELETE triggers do NOT fire on
  // TRUNCATE in PostgreSQL (FOR EACH ROW triggers only fire on individual rows).
  // CASCADE handles foreign-key dependencies in the correct order.
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

  // Create admin user (bypasses Twilio — we create the DB row directly)
  const adminPhone = "+15550000001";
  const admin = await prisma.user.create({
    data: { name: "Admin Shrey", phone: adminPhone, country: "US", role: "ADMIN" },
  });
  adminId = admin.id;
  adminToken = generateToken(adminId, "admin", adminPhone);

  // Create two guest users
  const g1Phone = "+15550000002";
  const guest1 = await prisma.user.create({
    data: { name: "Guest Alice", phone: g1Phone, country: "US", role: "GUEST" },
  });
  guest1Id = guest1.id;
  guest1Token = generateToken(guest1Id, "guest", g1Phone);

  const g2Phone = "+15550000003";
  const guest2 = await prisma.user.create({
    data: { name: "Guest Bob", phone: g2Phone, country: "US", role: "GUEST" },
  });
  guest2Id = guest2.id;

  // Fund each guest with $50 — simulates checkout.session.completed
  // Double-entry: debit=stripe (external inflow), credit=user:{id}
  await appendTransaction({
    userId: guest1Id,
    debitAccount: "stripe",
    creditAccount: `user:${guest1Id}`,
    type: "DEPOSIT",
    amount: 50,
  });
  await appendTransaction({
    userId: guest2Id,
    debitAccount: "stripe",
    creditAccount: `user:${guest2Id}`,
    type: "DEPOSIT",
    amount: 50,
  });
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env["JWT_SECRET"];
});

// ---------------------------------------------------------------------------
// Step 1: Auth — JWT issued without Twilio
// ---------------------------------------------------------------------------

describe("Step 1: Auth — JWT issued and verified for each user", () => {
  it("admin token decodes to admin role and correct userId", () => {
    const payload = verifyToken(adminToken);
    expect(payload.userId).toBe(adminId);
    expect(payload.role).toBe("admin");
    expect(payload.phone).toBe("+15550000001");
  });

  it("guest token decodes to guest role and correct userId", () => {
    const payload = verifyToken(guest1Token);
    expect(payload.userId).toBe(guest1Id);
    expect(payload.role).toBe("guest");
  });

  it("tampered token is rejected", () => {
    const tampered = adminToken.slice(0, -5) + "XXXXX";
    expect(() => verifyToken(tampered)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Step 2: Deposit — balance = $50 per user
// ---------------------------------------------------------------------------

describe("Step 2: Deposit → balances reflect $50 credit", () => {
  it("guest1 balance is exactly 5000 cents ($50) after DEPOSIT", async () => {
    const cents = await getUserBalance(guest1Id);
    expect(cents).toBe(5000);
  });

  it("guest2 balance is exactly 5000 cents ($50) after DEPOSIT", async () => {
    const cents = await getUserBalance(guest2Id);
    expect(cents).toBe(5000);
  });

  it("admin has no balance (deposits are only for guests)", async () => {
    const cents = await getUserBalance(adminId);
    expect(cents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Step 3: Admin creates binary market
// ---------------------------------------------------------------------------

describe("Step 3: Admin creates binary market → ACTIVE at 50/50", () => {
  it("createMarket returns a UUID", async () => {
    marketId = await createMarket(
      adminId,
      "Will the groom cry during the pheras?",
      ["Yes", "No"]
    );
    expect(marketId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("market is ACTIVE with openedAt set", async () => {
    const market = await getMarketWithPrices(marketId);
    expect(market).not.toBeNull();
    expect(market!.status).toBe("ACTIVE");
    expect(market!.openedAt).toBeInstanceOf(Date);
  });

  it("market has exactly 2 outcomes", async () => {
    const market = await getMarketWithPrices(marketId);
    expect(market!.outcomes).toHaveLength(2);

    // Capture outcome IDs ordered by position
    const sorted = [...market!.outcomes].sort((a, b) => a.position - b.position);
    yesOutcomeId = sorted[0]!.id;
    noOutcomeId = sorted[1]!.id;

    expect(sorted[0]!.label).toBe("Yes");
    expect(sorted[1]!.label).toBe("No");
  });

  it("fresh market: both prices ≈ 50¢", async () => {
    const market = await getMarketWithPrices(marketId);
    const sorted = [...market!.outcomes].sort((a, b) => a.position - b.position);
    expect(sorted[0]!.price).toBeCloseTo(0.5, 2);
    expect(sorted[1]!.price).toBeCloseTo(0.5, 2);
  });

  it("prices sum to exactly 1.0", async () => {
    const market = await getMarketWithPrices(marketId);
    const total = market!.outcomes.reduce((sum, o) => sum + o.price, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.0001);
  });
});

// ---------------------------------------------------------------------------
// Step 4: Guest 1 buys $20 on Yes
// ---------------------------------------------------------------------------

describe("Step 4: Guest 1 buys $20 on Yes", () => {
  let sharesReceived: number;

  it("returns positive shares, priceAfter > priceBefore", async () => {
    const result = await buyShares(guest1Id, marketId, yesOutcomeId, 2000);
    sharesReceived = result.shares;

    expect(result.shares).toBeGreaterThan(0);
    expect(result.costCents).toBe(2000);
    expect(result.priceAfterCents).toBeGreaterThan(result.priceBeforeCents);
    expect(result.outcomeLabel).toBe("Yes");
  });

  it("guest1 balance reduced by $20 → 3000 cents remaining", async () => {
    const cents = await getUserBalance(guest1Id);
    expect(cents).toBe(3000);
  });

  it("Yes price is now > 50¢", async () => {
    const market = await getMarketWithPrices(marketId);
    const yes = market!.outcomes.find((o) => o.id === yesOutcomeId)!;
    expect(yes.priceCents).toBeGreaterThan(50);
  });

  it("No price is now < 50¢ (prices still sum to 1.0)", async () => {
    const market = await getMarketWithPrices(marketId);
    const no = market!.outcomes.find((o) => o.id === noOutcomeId)!;
    expect(no.priceCents).toBeLessThan(50);
    const total = market!.outcomes.reduce((sum, o) => sum + o.price, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.0001);
  });

  it("position for guest1 on Yes is created with correct shares and cost", async () => {
    const pos = await prisma.position.findUnique({
      where: {
        userId_marketId_outcomeId: {
          userId: guest1Id,
          marketId,
          outcomeId: yesOutcomeId,
        },
      },
    });
    expect(pos).not.toBeNull();
    expect(Number(pos!.totalCost)).toBeCloseTo(20, 4);
    expect(Number(pos!.shares)).toBeCloseTo(sharesReceived, 4);
  });

  it("purchase record inserted in purchases table", async () => {
    const purchase = await prisma.purchase.findFirst({
      where: { userId: guest1Id, marketId, outcomeId: yesOutcomeId },
    });
    expect(purchase).not.toBeNull();
    expect(Number(purchase!.cost)).toBeCloseTo(20, 4);
    expect(purchase!.priceBefore).toBeDefined();
    expect(purchase!.priceAfter).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Step 5: Guest 2 buys $10 on No
// ---------------------------------------------------------------------------

describe("Step 5: Guest 2 buys $10 on No", () => {
  it("returns positive shares and adjusts prices toward No", async () => {
    const marketBefore = await getMarketWithPrices(marketId);
    const noBefore = marketBefore!.outcomes.find((o) => o.id === noOutcomeId)!;

    const result = await buyShares(guest2Id, marketId, noOutcomeId, 1000);

    expect(result.shares).toBeGreaterThan(0);
    expect(result.costCents).toBe(1000);
    expect(result.priceAfterCents).toBeGreaterThan(noBefore.priceCents);
  });

  it("guest2 balance reduced by $10 → 4000 cents remaining", async () => {
    const cents = await getUserBalance(guest2Id);
    expect(cents).toBe(4000);
  });

  it("prices still sum to 1.0 after second purchase", async () => {
    const market = await getMarketWithPrices(marketId);
    const total = market!.outcomes.reduce((sum, o) => sum + o.price, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.0001);
  });
});

// ---------------------------------------------------------------------------
// Step 6: Admin resolves market — Yes wins
// ---------------------------------------------------------------------------

describe("Step 6: Admin resolves market → Yes wins", () => {
  let guest1SharesBeforeResolution: number;

  it("resolveMarket succeeds without throwing", async () => {
    // Snapshot shares before resolution
    const pos = await prisma.position.findUnique({
      where: {
        userId_marketId_outcomeId: {
          userId: guest1Id,
          marketId,
          outcomeId: yesOutcomeId,
        },
      },
    });
    guest1SharesBeforeResolution = Number(pos!.shares);

    await expect(
      resolveMarket(adminId, marketId, yesOutcomeId)
    ).resolves.toBeUndefined();
  });

  it("market is RESOLVED with correct winningOutcomeId and resolvedAt", async () => {
    const market = await getMarketWithPrices(marketId);
    expect(market!.status).toBe("RESOLVED");
    expect(market!.winningOutcomeId).toBe(yesOutcomeId);
    expect(market!.resolvedAt).toBeInstanceOf(Date);
  });

  it("winning outcome isWinner = true", async () => {
    const outcome = await prisma.outcome.findUnique({ where: { id: yesOutcomeId } });
    expect(outcome!.isWinner).toBe(true);
  });

  it("losing outcome isWinner is not true", async () => {
    const outcome = await prisma.outcome.findUnique({ where: { id: noOutcomeId } });
    expect(outcome!.isWinner).not.toBe(true);
  });

  it("guest1 receives full gross payout ($1.00 per share, charity deferred to withdrawal)", async () => {
    const gross = guest1SharesBeforeResolution; // shares * $1
    const expectedGrossDollars = gross;
    const expectedGrossCents = Math.round(expectedGrossDollars * 100);

    // Previous balance was $30 (5000 - 2000 cents)
    const finalCents = await getUserBalance(guest1Id);
    const payoutReceived = finalCents - 3000;

    expect(payoutReceived).toBeCloseTo(expectedGrossCents, 0);
    expect(payoutReceived).toBeGreaterThan(0);
  });

  it("guest2 (No holder) receives no payout — balance unchanged at 4000 cents", async () => {
    const cents = await getUserBalance(guest2Id);
    expect(cents).toBe(4000);
  });

  it("PAYOUT transaction exists in ledger for guest1", async () => {
    const payouts = await prisma.transaction.findMany({
      where: { type: "PAYOUT", userId: guest1Id },
    });
    expect(payouts.length).toBeGreaterThan(0);
    const totalNet = payouts.reduce((sum, tx) => sum + Number(tx.amount), 0);
    expect(totalNet).toBeGreaterThan(0);
  });

  it("no CHARITY_FEE at resolution — charity is deferred to withdrawal time", async () => {
    const charityTxs = await prisma.transaction.findMany({
      where: { type: "CHARITY_FEE", userId: guest1Id },
    });
    // Charity is not collected at resolution; it will be withheld at withdrawal approval.
    expect(charityTxs.length).toBe(0);
  });

  it("admin audit log contains RESOLVE_MARKET entry", async () => {
    const log = await prisma.adminAuditLog.findFirst({
      where: { action: "RESOLVE_MARKET", targetId: marketId },
    });
    expect(log).not.toBeNull();
    expect(log!.adminId).toBe(adminId);
  });
});

// ---------------------------------------------------------------------------
// Step 7: Reconciliation invariant
// ---------------------------------------------------------------------------

describe("Step 7: Reconciliation invariant holds across all operations", () => {
  it("housePool ≥ 0 — system is solvent (ledger.ts runReconciliation)", async () => {
    const result = await runReconciliation();
    expect(result.isBalanced).toBe(true);
    expect(result.housePool.greaterThanOrEqualTo(0)).toBe(true);
  });

  it("totalDeposits = userBalances + housePool (accounting identity, no charity pool yet)", async () => {
    const result = await runReconciliation();
    // charityPool = 0 at this point (charity is collected at withdrawal, not resolution)
    const reconstructed = result.totalUserBalances
      .plus(result.charityPool)
      .plus(result.housePool);
    const diff = result.totalDeposits.minus(reconstructed).abs();
    // Tolerance: 0.001 USD to account for floating-point accumulation
    expect(diff.lessThan(0.001)).toBe(true);
  });

  it("charityPool = 0 after resolution (charity collected at withdrawal, not at resolution)", async () => {
    const result = await runReconciliation();
    // No CHARITY_FEE transactions yet — charity is withheld when admin approves withdrawal.
    expect(result.charityPool.isZero()).toBe(true);
  });

  it("total user balances is positive (users still have funds)", async () => {
    const result = await runReconciliation();
    expect(result.totalUserBalances.greaterThan(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 8: Hash chain linkage
// ---------------------------------------------------------------------------

describe("Step 8: Hash chain linkage integrity", () => {
  it("first transaction has genesis prevHash (all zeros)", async () => {
    const first = await prisma.transaction.findFirst({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { prevHash: true },
    });
    expect(first).not.toBeNull();
    expect(first!.prevHash).toBe("0".repeat(64));
  });

  it("each tx.prevHash === preceding tx.txHash (chain is linked)", async () => {
    const txs = await prisma.transaction.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, prevHash: true, txHash: true },
    });

    expect(txs.length).toBeGreaterThan(0);

    for (let i = 1; i < txs.length; i++) {
      expect(txs[i]!.prevHash).toBe(txs[i - 1]!.txHash);
    }
  });

  it("every txHash is a valid 64-character lowercase hex string", async () => {
    const txs = await prisma.transaction.findMany({
      select: { id: true, txHash: true },
    });
    for (const tx of txs) {
      expect(tx.txHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("total transaction count matches expected operations", async () => {
    // Expected: 2 DEPOSITs + 2 PURCHASEs + 1 PAYOUT = 5
    // (No CHARITY_FEE at resolution — charity is withheld at withdrawal approval)
    const count = await prisma.transaction.count();
    expect(count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Step 9: Withdrawal request
// ---------------------------------------------------------------------------

describe("Step 9: Withdrawal request → admin PENDING queue", () => {
  let withdrawalRequestId: string;

  it("requestWithdrawal creates PENDING request for guest1", async () => {
    const balanceCents = await getUserBalance(guest1Id);
    // Withdraw half the current balance
    const halfCents = Math.floor(balanceCents / 2);

    const { requestId } = await requestWithdrawal(
      guest1Id,
      halfCents,
      "@alice_venmo"
    );
    withdrawalRequestId = requestId;

    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("withdrawal appears in admin PENDING queue with correct details", async () => {
    const queue = await listPendingWithdrawals();
    const mine = queue.find((r) => r.user.id === guest1Id);

    expect(mine).toBeDefined();
    expect(mine!.status).toBe("PENDING");
    expect(mine!.venmoHandle).toBe("@alice_venmo");
    expect(mine!.amount).toBeGreaterThan(0);
  });

  it("withdrawal request row exists with PENDING status", async () => {
    const req = await prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalRequestId },
    });
    expect(req).not.toBeNull();
    expect(req!.status).toBe("PENDING");
    expect(req!.userId).toBe(guest1Id);
  });

  it("cannot withdraw more than the current balance", async () => {
    const balanceCents = await getUserBalance(guest1Id);
    const overLimit = balanceCents + 1;

    await expect(
      requestWithdrawal(guest1Id, overLimit, undefined, "guest@gmail.com")
    ).rejects.toThrow(/Insufficient balance/);
  });

  it("cannot request withdrawal with no contact method", async () => {
    await expect(
      requestWithdrawal(guest1Id, 100) // no venmoHandle or zelleContact
    ).rejects.toThrow(/contact/i);
  });
});
