/**
 * Ledger Service — Unit Tests (Prisma mocked)
 *
 * Tests:
 *  1. appendTransaction — hash chain validity: prevHash chains correctly,
 *     txHash is computed from the correct inputs, genesis hash on empty ledger.
 *
 *  2. runReconciliation — invariant holds for valid states, detects violations:
 *     user_balances + house_amm + charity_pool + withdrawals = deposits.
 *
 *  3. getUserBalance — correct credit/debit accounting from the ledger.
 *
 *  4. getCharityPoolTotal / getTotalDeposits — correct sums.
 *
 * Strategy: mock the db module (prisma) so no database is required.
 * The hash computation (computeHash) runs against the REAL implementation —
 * only database I/O is replaced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  appendTransaction,
  getUserBalance,
  runReconciliation,
  getCharityPoolTotal,
  getTotalDeposits,
} from "../ledger.js";

// ---------------------------------------------------------------------------
// Mock: prisma (db module)
// ---------------------------------------------------------------------------

vi.mock("../../db.js", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GENESIS_HASH = "0".repeat(64);
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

/** Recompute a txHash the same way ledger.ts + hashChain.ts do. */
function expectedHash(
  prevHash: string,
  type: string,
  amountDollars: number,
  userId: string,
  isoTimestamp: string
): string {
  const amount = amountDollars.toFixed(6);
  const data = `${prevHash}|${type}|${amount}|${userId}|${isoTimestamp}`;
  return createHash("sha256").update(data, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Mock factory for prisma.$transaction
// ---------------------------------------------------------------------------

/**
 * Build a mock tx that supports appendTransaction's internal sequence:
 *   tx.transaction.findFirst  → null (empty ledger) or { txHash: lastHash }
 *   tx.transaction.create     → { id: <id> }
 *
 * Returns the tx mock AND a `captured` array that records every create() call.
 */
function makeLedgerTx(opts: {
  lastTxHash?: string | null;
  newId?: string;
}) {
  const captured: Array<Record<string, unknown>> = [];

  const tx = {
    transaction: {
      findFirst: vi.fn().mockResolvedValue(
        opts.lastTxHash ? { txHash: opts.lastTxHash } : null
      ),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        captured.push(data);
        return Promise.resolve({ id: opts.newId ?? "tx-id-1" });
      }),
    },
  };

  return { tx, captured };
}

/** Wire prisma.$transaction to execute the callback with a mock tx. */
function mockTransaction(tx: ReturnType<typeof makeLedgerTx>["tx"]): void {
  vi.mocked(prisma.$transaction).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (fn: any) => fn(tx)
  );
}

// ---------------------------------------------------------------------------
// Mock factory for $queryRaw
// ---------------------------------------------------------------------------

type MockQueryClient = {
  $queryRaw: ReturnType<typeof vi.fn>;
};

function makeQueryClient(): MockQueryClient {
  return { $queryRaw: vi.fn() };
}

// ---------------------------------------------------------------------------
// 1. appendTransaction — hash chain validity
// ---------------------------------------------------------------------------

describe("appendTransaction — hash chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses GENESIS_HASH as prevHash for the very first transaction", async () => {
    const { tx, captured } = makeLedgerTx({ lastTxHash: null, newId: "tx-001" });
    mockTransaction(tx);

    const fixedDate = new Date("2026-03-27T10:00:00.000Z");

    await appendTransaction({
      userId: USER_ID,
      debitAccount: `user:${USER_ID}`,
      creditAccount: "house_amm",
      type: "DEPOSIT",
      amount: 20,
      createdAt: fixedDate,
    });

    expect(captured).toHaveLength(1);
    const inserted = captured[0]!;
    expect(inserted["prevHash"]).toBe(GENESIS_HASH);
  });

  it("computes a correct SHA-256 txHash for the first transaction", async () => {
    const { tx, captured } = makeLedgerTx({ lastTxHash: null, newId: "tx-001" });
    mockTransaction(tx);

    const fixedDate = new Date("2026-03-27T10:00:00.000Z");

    await appendTransaction({
      userId: USER_ID,
      debitAccount: `user:${USER_ID}`,
      creditAccount: "house_amm",
      type: "DEPOSIT",
      amount: 20,
      createdAt: fixedDate,
    });

    const inserted = captured[0]!;
    const want = expectedHash(GENESIS_HASH, "DEPOSIT", 20, USER_ID, fixedDate.toISOString());
    expect(inserted["txHash"]).toBe(want);
  });

  it("uses the previous transaction's txHash as prevHash for subsequent transactions", async () => {
    // --- First transaction ---
    const firstDate = new Date("2026-03-27T10:00:00.000Z");
    const { tx: tx1, captured: cap1 } = makeLedgerTx({ lastTxHash: null, newId: "tx-001" });
    mockTransaction(tx1);

    await appendTransaction({
      userId: USER_ID,
      debitAccount: `user:${USER_ID}`,
      creditAccount: "house_amm",
      type: "DEPOSIT",
      amount: 20,
      createdAt: firstDate,
    });

    const firstTxHash = cap1[0]!["txHash"] as string;

    // --- Second transaction uses first txHash as prevHash ---
    const secondDate = new Date("2026-03-27T10:01:00.000Z");
    const { tx: tx2, captured: cap2 } = makeLedgerTx({
      lastTxHash: firstTxHash,
      newId: "tx-002",
    });
    mockTransaction(tx2);

    await appendTransaction({
      userId: USER_ID,
      debitAccount: `user:${USER_ID}`,
      creditAccount: "house_amm",
      type: "PURCHASE",
      amount: 10,
      createdAt: secondDate,
    });

    expect(cap2[0]!["prevHash"]).toBe(firstTxHash);
  });

  it("chains 3 sequential transactions: each prevHash = previous txHash", async () => {
    const dates = [
      new Date("2026-03-27T10:00:00.000Z"),
      new Date("2026-03-27T10:01:00.000Z"),
      new Date("2026-03-27T10:02:00.000Z"),
    ];
    const amounts = [20, 10, 5];
    const types = ["DEPOSIT", "PURCHASE", "PAYOUT"] as const;
    const ids = ["tx-001", "tx-002", "tx-003"];

    let lastHash: string | null = null;
    const insertedHashes: string[] = [];

    for (let i = 0; i < 3; i++) {
      const { tx, captured } = makeLedgerTx({ lastTxHash: lastHash, newId: ids[i] });
      mockTransaction(tx);

      await appendTransaction({
        userId: USER_ID,
        debitAccount: `user:${USER_ID}`,
        creditAccount: "house_amm",
        type: types[i]!,
        amount: amounts[i]!,
        createdAt: dates[i],
      });

      const row = captured[0]!;
      const prevHashUsed = i === 0 ? GENESIS_HASH : insertedHashes[i - 1]!;
      expect(row["prevHash"]).toBe(prevHashUsed);

      const wantHash = expectedHash(
        prevHashUsed,
        types[i]!,
        amounts[i]!,
        USER_ID,
        dates[i]!.toISOString()
      );
      expect(row["txHash"]).toBe(wantHash);

      insertedHashes.push(row["txHash"] as string);
      lastHash = row["txHash"] as string;
    }

    // Verify the chain linkage end-to-end
    expect(insertedHashes[1]).toBeDefined();
    expect(insertedHashes[0]).not.toBe(insertedHashes[1]);
    expect(insertedHashes[1]).not.toBe(insertedHashes[2]);
  });

  it("returns the new transaction id and txHash", async () => {
    const { tx } = makeLedgerTx({ lastTxHash: null, newId: "my-custom-id" });
    mockTransaction(tx);

    const result = await appendTransaction({
      userId: USER_ID,
      debitAccount: `user:${USER_ID}`,
      creditAccount: "house_amm",
      type: "DEPOSIT",
      amount: 10,
    });

    expect(result.id).toBe("my-custom-id");
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("includes stripeSessionId in the inserted row when provided", async () => {
    const { tx, captured } = makeLedgerTx({ lastTxHash: null, newId: "tx-stripe" });
    mockTransaction(tx);

    await appendTransaction({
      userId: USER_ID,
      debitAccount: `user:${USER_ID}`,
      creditAccount: "house_amm",
      type: "DEPOSIT",
      amount: 25,
      stripeSessionId: "cs_test_abc123",
    });

    expect(captured[0]!["stripeSessionId"]).toBe("cs_test_abc123");
  });
});

// ---------------------------------------------------------------------------
// 2. runReconciliation — conservation invariant
// ---------------------------------------------------------------------------

describe("runReconciliation — conservation invariant", () => {
  it("returns valid=true and all zeros for an empty ledger", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([]);

    const result = await runReconciliation(client as Parameters<typeof runReconciliation>[0]);

    expect(result.valid).toBe(true);
    expect(result.totalDeposits).toBe(0);
    expect(result.userBalances).toBe(0);
    expect(result.diff).toBe(0);
  });

  it("returns valid=true when invariant holds exactly", async () => {
    // $20 deposited, user has $10 balance, house_amm has $10
    // lhs = 10 + 10 + 0 + 0 = 20 = rhs ✓
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([
      {
        user_balances: 10,
        house_amm: 10,
        charity_pool: 0,
        total_deposits: 20,
        total_withdrawals: 0,
      },
    ]);

    const result = await runReconciliation(client as Parameters<typeof runReconciliation>[0]);

    expect(result.valid).toBe(true);
    expect(result.userBalances).toBe(10);
    expect(result.houseAmm).toBe(10);
    expect(result.charityPool).toBe(0);
    expect(result.totalDeposits).toBe(20);
    expect(result.lhs).toBe(20);
    expect(result.rhs).toBe(20);
    expect(result.diff).toBeLessThan(0.0001);
  });

  it("returns valid=true including charity_pool and withdrawals", async () => {
    // $100 deposits, user balance $30, house_amm $50, charity $10, withdrawals $10
    // lhs = 30 + 50 + 10 + 10 = 100 = rhs ✓
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([
      {
        user_balances: 30,
        house_amm: 50,
        charity_pool: 10,
        total_deposits: 100,
        total_withdrawals: 10,
      },
    ]);

    const result = await runReconciliation(client as Parameters<typeof runReconciliation>[0]);

    expect(result.valid).toBe(true);
    expect(Math.abs(result.lhs - result.rhs)).toBeLessThan(0.0001);
  });

  it("returns valid=false and diff > 0 when invariant is violated", async () => {
    // Tampered: user_balances = $999 but deposits = $20 — clear violation
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([
      {
        user_balances: 999,
        house_amm: 0,
        charity_pool: 0,
        total_deposits: 20,
        total_withdrawals: 0,
      },
    ]);

    const result = await runReconciliation(client as Parameters<typeof runReconciliation>[0]);

    expect(result.valid).toBe(false);
    expect(result.diff).toBeGreaterThan(0.0001);
  });

  it("returns valid=false for a small discrepancy > 0.0001", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([
      {
        user_balances: 10.01,
        house_amm: 10,
        charity_pool: 0,
        total_deposits: 20,
        total_withdrawals: 0,
      },
    ]);

    const result = await runReconciliation(client as Parameters<typeof runReconciliation>[0]);

    expect(result.valid).toBe(false);
    expect(result.diff).toBeCloseTo(0.01, 4);
  });

  it("returns valid=true for floating-point noise below 0.0001 threshold", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([
      {
        user_balances: 10.000001,
        house_amm: 9.999999,
        charity_pool: 0,
        total_deposits: 20,
        total_withdrawals: 0,
      },
    ]);

    const result = await runReconciliation(client as Parameters<typeof runReconciliation>[0]);

    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. getUserBalance — correct derived balance
// ---------------------------------------------------------------------------

describe("getUserBalance — derived from ledger", () => {
  it("returns balance in integer cents (credits - debits)", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([{ balance: 10.5 }]);

    const balance = await getUserBalance(USER_ID, client as Parameters<typeof getUserBalance>[1]);

    // 10.5 dollars = 1050 cents
    expect(balance).toBe(1050);
  });

  it("returns 0 cents for a user with no transactions", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([{ balance: 0 }]);

    const balance = await getUserBalance(USER_ID, client as Parameters<typeof getUserBalance>[1]);

    expect(balance).toBe(0);
  });

  it("returns 0 for null/missing balance result", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([]);

    const balance = await getUserBalance(USER_ID, client as Parameters<typeof getUserBalance>[1]);

    expect(balance).toBe(0);
  });

  it("rounds to the nearest cent", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([{ balance: 20.005 }]);

    const balance = await getUserBalance(USER_ID, client as Parameters<typeof getUserBalance>[1]);

    expect(balance).toBe(2001);
  });

  it("handles negative balance (over-spent scenario)", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([{ balance: -5 }]);

    const balance = await getUserBalance(USER_ID, client as Parameters<typeof getUserBalance>[1]);

    expect(balance).toBe(-500); // -$5 = -500 cents
  });
});

// ---------------------------------------------------------------------------
// 4. getCharityPoolTotal — derived charity balance
// ---------------------------------------------------------------------------

describe("getCharityPoolTotal", () => {
  it("returns the net charity pool in integer cents", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([{ total: 2.4 }]); // $2.40

    const total = await getCharityPoolTotal(client as Parameters<typeof getCharityPoolTotal>[0]);

    expect(total).toBe(240);
  });

  it("returns 0 when no charity fees have been collected", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([{ total: 0 }]);

    const total = await getCharityPoolTotal(client as Parameters<typeof getCharityPoolTotal>[0]);

    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. getTotalDeposits
// ---------------------------------------------------------------------------

describe("getTotalDeposits", () => {
  it("returns sum of DEPOSIT transactions in integer cents", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([{ total: 75 }]); // $75.00

    const total = await getTotalDeposits(client as Parameters<typeof getTotalDeposits>[0]);

    expect(total).toBe(7500);
  });

  it("returns 0 with no deposits", async () => {
    const client = makeQueryClient();
    client.$queryRaw.mockResolvedValue([]);

    const total = await getTotalDeposits(client as Parameters<typeof getTotalDeposits>[0]);

    expect(total).toBe(0);
  });
});
