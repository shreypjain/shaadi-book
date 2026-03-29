/**
 * Withdrawal Service — Unit Tests (Prisma mocked)
 *
 * Paths tested:
 *
 *  requestWithdrawal:
 *    1. Happy path — creates PENDING request
 *    2. INVALID_AMOUNT — non-integer cents
 *    3. INVALID_AMOUNT — zero cents
 *    4. NO_CONTACT_METHOD — no venmoHandle or zelleContact
 *    5. INSUFFICIENT_BALANCE — balance < amount
 *
 *  approveWithdrawal:
 *    6. Happy path — inserts WITHDRAWAL tx, sets APPROVED, reconciliation passes
 *    7. REQUEST_NOT_FOUND — request does not exist
 *    8. REQUEST_NOT_PENDING — request already APPROVED
 *    9. INSUFFICIENT_BALANCE — balance too low at approval time
 *   10. RECONCILIATION_FAILED — invariant broken
 *
 *  completeWithdrawal:
 *   11. Happy path — sets COMPLETED + processedAt
 *   12. REQUEST_NOT_FOUND
 *   13. REQUEST_NOT_APPROVED — request still PENDING
 *
 *  rejectWithdrawal:
 *   14. Happy path — sets REJECTED, creates audit log
 *   15. REQUEST_NOT_FOUND
 *   16. REQUEST_NOT_PENDING — request already APPROVED
 *
 *  listPendingWithdrawals / getUserWithdrawals:
 *   17. listPendingWithdrawals — calls findMany with status PENDING
 *   18. getUserWithdrawals — calls findMany with correct userId filter
 *
 * Strategy: mock the db module so prisma methods are vi.fn() stubs.
 * prisma.$transaction calls the callback with a controlled tx object.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requestWithdrawal,
  approveWithdrawal,
  completeWithdrawal,
  rejectWithdrawal,
  listPendingWithdrawals,
  getUserWithdrawals,
  WithdrawalError,
} from "../withdrawalService.js";

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

vi.mock("../../db.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    withdrawalRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const ADMIN_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const REQUEST_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const TX_ID = "cccccccc-0000-0000-0000-000000000001";
const IP = "127.0.0.1";

const MOCK_REQUEST_PENDING = {
  id: REQUEST_ID,
  userId: USER_ID,
  amount: "50.000000", // $50 as Decimal-like string
  status: "PENDING",
};

const MOCK_REQUEST_APPROVED = {
  ...MOCK_REQUEST_PENDING,
  status: "APPROVED",
  adminId: ADMIN_ID,
};

// ---------------------------------------------------------------------------
// approve tx helper
// ---------------------------------------------------------------------------

function makeApproveTx() {
  return {
    $queryRaw: vi.fn(),
    withdrawalRequest: { findUnique: vi.fn(), update: vi.fn() },
    transaction: { findFirst: vi.fn(), create: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  };
}

function wireApproveTxHappyPath(
  tx: ReturnType<typeof makeApproveTx>,
  opts: { balanceDollars?: number; totalDeposits?: number } = {}
) {
  const { balanceDollars = 100, totalDeposits = 100 } = opts;
  // 1. findUnique — request
  tx.withdrawalRequest.findUnique.mockResolvedValue(MOCK_REQUEST_PENDING);
  // 2. $queryRaw balance check
  tx.$queryRaw.mockResolvedValueOnce([{ balance: balanceDollars }]);
  // 3a. $queryRaw — user total deposits
  tx.$queryRaw.mockResolvedValueOnce([{ total: totalDeposits }]);
  // 3b. $queryRaw — user past charity fees paid
  tx.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
  // 3c. $queryRaw — user past withdrawals
  //     With totalDeposits = balanceDollars and no prior payouts, profit = 0
  //     → charityRemaining = 0 → no CHARITY_FEE tx inserted.
  tx.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
  // 4. transaction.findFirst (prevHash)
  tx.transaction.findFirst.mockResolvedValue(null);
  // 5. transaction.create — WITHDRAWAL only (no charity owed)
  tx.transaction.create.mockResolvedValue({ id: TX_ID });
  // 6. withdrawalRequest.update → APPROVED
  tx.withdrawalRequest.update.mockResolvedValue({});
  // 7. adminAuditLog.create
  tx.adminAuditLog.create.mockResolvedValue({});
  // 8. reconciliation — balanced: user_bal=$50 withdrawn, deposits=$100
  tx.$queryRaw.mockResolvedValueOnce([
    {
      user_balances:     50,
      house_amm:         0,
      charity_pool:      0,
      total_deposits:    100,
      total_withdrawals: 50,
    },
  ]);
}

// ---------------------------------------------------------------------------
// 1–5. requestWithdrawal
// ---------------------------------------------------------------------------

describe("requestWithdrawal — happy path", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates a PENDING WithdrawalRequest and returns requestId", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ balance: 100 }]);
    vi.mocked(prisma.withdrawalRequest.create).mockResolvedValue({
      id: REQUEST_ID,
    } as never);

    const result = await requestWithdrawal(USER_ID, 5000, "@alice");

    expect(result.requestId).toBe(REQUEST_ID);
    expect(prisma.withdrawalRequest.create).toHaveBeenCalledOnce();

    const createData = vi.mocked(prisma.withdrawalRequest.create).mock
      .calls[0]?.[0]?.data;
    expect(createData?.userId).toBe(USER_ID);
    expect(createData?.status).toBe("PENDING");
    expect(createData?.venmoHandle).toBe("@alice");
  });

  it("accepts zelleContact when venmoHandle is absent", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ balance: 100 }]);
    vi.mocked(prisma.withdrawalRequest.create).mockResolvedValue({
      id: REQUEST_ID,
    } as never);

    const result = await requestWithdrawal(
      USER_ID,
      1000,
      undefined,
      "alice@example.com"
    );
    expect(result.requestId).toBe(REQUEST_ID);

    const createData = vi.mocked(prisma.withdrawalRequest.create).mock
      .calls[0]?.[0]?.data;
    expect(createData?.zelleContact).toBe("alice@example.com");
  });
});

describe("requestWithdrawal — validation errors", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws INVALID_AMOUNT for non-integer cents", async () => {
    await expect(
      requestWithdrawal(USER_ID, 9.99, "@alice")
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("throws INVALID_AMOUNT for zero cents", async () => {
    await expect(
      requestWithdrawal(USER_ID, 0, "@alice")
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("throws NO_CONTACT_METHOD when neither venmoHandle nor zelleContact provided", async () => {
    await expect(
      requestWithdrawal(USER_ID, 1000)
    ).rejects.toMatchObject({ code: "NO_CONTACT_METHOD" });
    // Balance should not be queried before contact validation
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("throws INSUFFICIENT_BALANCE when user balance < amount", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ balance: 5 }]);

    await expect(
      requestWithdrawal(USER_ID, 1000, "@alice") // $10 requested, $5 balance
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it("throws INSUFFICIENT_BALANCE when user has zero balance", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ balance: 0 }]);

    await expect(
      requestWithdrawal(USER_ID, 100, "@alice")
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });
});

// ---------------------------------------------------------------------------
// 6–10. approveWithdrawal
// ---------------------------------------------------------------------------

describe("approveWithdrawal — happy path", () => {
  let tx: ReturnType<typeof makeApproveTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeApproveTx();
    vi.mocked(prisma.$transaction).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: any) => fn(tx)
    );
  });

  it("returns transactionId on success", async () => {
    wireApproveTxHappyPath(tx);
    const result = await approveWithdrawal(ADMIN_ID, REQUEST_ID, IP);
    expect(result.transactionId).toBe(TX_ID);
  });

  it("inserts a WITHDRAWAL transaction with correct double-entry accounts", async () => {
    wireApproveTxHappyPath(tx);
    await approveWithdrawal(ADMIN_ID, REQUEST_ID, IP);

    expect(tx.transaction.create).toHaveBeenCalledOnce();
    const txData = tx.transaction.create.mock.calls[0]?.[0]?.data;
    expect(txData?.type).toBe("WITHDRAWAL");
    expect(txData?.debitAccount).toBe(`user:${USER_ID}`);
    expect(txData?.creditAccount).toBe("withdrawal_paid");
  });

  it("sets withdrawal request status to APPROVED", async () => {
    wireApproveTxHappyPath(tx);
    await approveWithdrawal(ADMIN_ID, REQUEST_ID, IP);

    expect(tx.withdrawalRequest.update).toHaveBeenCalledOnce();
    const updateArgs = tx.withdrawalRequest.update.mock.calls[0]?.[0];
    expect(updateArgs?.where?.id).toBe(REQUEST_ID);
    expect(updateArgs?.data?.status).toBe("APPROVED");
    expect(updateArgs?.data?.adminId).toBe(ADMIN_ID);
  });

  it("creates an APPROVE_WITHDRAWAL audit log entry", async () => {
    wireApproveTxHappyPath(tx);
    await approveWithdrawal(ADMIN_ID, REQUEST_ID, IP);

    expect(tx.adminAuditLog.create).toHaveBeenCalledOnce();
    const auditData = tx.adminAuditLog.create.mock.calls[0]?.[0]?.data;
    expect(auditData?.action).toBe("APPROVE_WITHDRAWAL");
    expect(auditData?.adminId).toBe(ADMIN_ID);
    expect(auditData?.targetId).toBe(REQUEST_ID);
    expect(auditData?.ipAddress).toBe(IP);
  });

  it("populates prevHash in the transaction (hash chain continuity)", async () => {
    wireApproveTxHappyPath(tx);
    // Simulate an existing tx in chain
    tx.transaction.findFirst.mockResolvedValue({
      txHash: "a".repeat(64),
    });

    await approveWithdrawal(ADMIN_ID, REQUEST_ID, IP);

    const txData = tx.transaction.create.mock.calls[0]?.[0]?.data;
    expect(txData?.prevHash).toBe("a".repeat(64));
  });

  it("inserts CHARITY_FEE before WITHDRAWAL when user has profit", async () => {
    // User deposited $100, has $150 balance (gained $50 from winning bets).
    // profit = $150 + $0 + $0 - $100 = $50
    // charityOwed = 20% * $50 = $10
    // charityRemaining = $10 - $0 = $10
    // withdrawal amount = $50 (MOCK_REQUEST_PENDING)
    // balance must cover $50 + $10 = $60 ✓ ($150 >= $60)
    tx.withdrawalRequest.findUnique.mockResolvedValue(MOCK_REQUEST_PENDING);
    tx.$queryRaw.mockResolvedValueOnce([{ balance: 150 }]); // balance check
    tx.$queryRaw.mockResolvedValueOnce([{ total: 100  }]); // deposits
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0    }]); // past charity paid
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0    }]); // past withdrawals
    tx.transaction.findFirst.mockResolvedValue(null);
    // transaction.create is called twice: CHARITY_FEE then WITHDRAWAL
    tx.transaction.create
      .mockResolvedValueOnce({ id: "charity-tx-id" })
      .mockResolvedValueOnce({ id: TX_ID });
    tx.withdrawalRequest.update.mockResolvedValue({});
    tx.adminAuditLog.create.mockResolvedValue({});
    // Reconciliation (balanced):
    //   pre-approval: user_bal=$150, house_amm=-$50, charity_pool=$0, withdrawals=$0, deposits=$100
    //   lhs = 150 + (-50) + 0 + 0 = 100 = deposits ✓
    //   After CHARITY_FEE($10) + WITHDRAWAL($50):
    //   user_bal = 150-10-50 = 90, charity_pool = 10, withdrawals = 50
    //   lhs = 90 + (-50) + 10 + 50 = 100 = deposits ✓
    tx.$queryRaw.mockResolvedValueOnce([{
      user_balances:     90,
      house_amm:         -50,
      charity_pool:      10,
      total_deposits:    100,
      total_withdrawals: 50,
    }]);

    const result = await approveWithdrawal(ADMIN_ID, REQUEST_ID, IP);

    // Two transaction rows should have been created
    expect(tx.transaction.create).toHaveBeenCalledTimes(2);

    // First call must be the CHARITY_FEE
    const charityData = tx.transaction.create.mock.calls[0]?.[0]?.data;
    expect(charityData?.type).toBe("CHARITY_FEE");
    expect(charityData?.creditAccount).toBe("charity_pool");
    expect(charityData?.debitAccount).toBe(`user:${USER_ID}`);
    // 20% of $50 profit = $10.000000
    expect(charityData?.amount.toFixed(6)).toBe("10.000000");

    // Second call must be the WITHDRAWAL, chaining from the CHARITY_FEE hash
    const withdrawalData = tx.transaction.create.mock.calls[1]?.[0]?.data;
    expect(withdrawalData?.type).toBe("WITHDRAWAL");
    expect(withdrawalData?.prevHash).toBe(charityData?.txHash);

    // Return value should be the WITHDRAWAL transaction id
    expect(result.transactionId).toBe(TX_ID);

    // Audit log should record charityFeeDollars
    const auditMeta = tx.adminAuditLog.create.mock.calls[0]?.[0]?.data?.metadata;
    expect(auditMeta?.charityFeeDollars).toBeCloseTo(10, 5);
  });
});

describe("approveWithdrawal — error paths", () => {
  let tx: ReturnType<typeof makeApproveTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = makeApproveTx();
    vi.mocked(prisma.$transaction).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: any) => fn(tx)
    );
  });

  it("throws REQUEST_NOT_FOUND when request does not exist", async () => {
    tx.withdrawalRequest.findUnique.mockResolvedValue(null);

    await expect(
      approveWithdrawal(ADMIN_ID, REQUEST_ID, IP)
    ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
  });

  it("throws REQUEST_NOT_PENDING when request is already APPROVED", async () => {
    tx.withdrawalRequest.findUnique.mockResolvedValue(MOCK_REQUEST_APPROVED);

    await expect(
      approveWithdrawal(ADMIN_ID, REQUEST_ID, IP)
    ).rejects.toMatchObject({ code: "REQUEST_NOT_PENDING" });
    // No transaction should be inserted
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("throws INSUFFICIENT_BALANCE when user balance is too low at approval time", async () => {
    tx.withdrawalRequest.findUnique.mockResolvedValue(MOCK_REQUEST_PENDING); // $50
    // Balance check: only $10 available
    tx.$queryRaw.mockResolvedValueOnce([{ balance: 10 }]);
    // User totals: deposits = $10, no prior charity/withdrawals → profit = 0 → no charity owed
    tx.$queryRaw.mockResolvedValueOnce([{ total: 10 }]); // deposits
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0  }]); // past charity paid
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0  }]); // past withdrawals

    await expect(
      approveWithdrawal(ADMIN_ID, REQUEST_ID, IP)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("throws RECONCILIATION_FAILED when invariant is broken", async () => {
    tx.withdrawalRequest.findUnique.mockResolvedValue(MOCK_REQUEST_PENDING);
    // Balance check: $100 available
    tx.$queryRaw.mockResolvedValueOnce([{ balance: 100 }]);
    // User totals (three separate queries): deposits = $100, no prior charity/withdrawals
    tx.$queryRaw.mockResolvedValueOnce([{ total: 100 }]); // deposits
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0   }]); // past charity paid
    tx.$queryRaw.mockResolvedValueOnce([{ total: 0   }]); // past withdrawals
    tx.transaction.findFirst.mockResolvedValue(null);
    tx.transaction.create.mockResolvedValue({ id: TX_ID });
    tx.withdrawalRequest.update.mockResolvedValue({});
    tx.adminAuditLog.create.mockResolvedValue({});

    // Broken reconciliation: lhs ≠ rhs
    tx.$queryRaw.mockResolvedValueOnce([
      {
        user_balances:     999,
        house_amm:         0,
        charity_pool:      0,
        total_deposits:    100,
        total_withdrawals: 50,
      },
    ]);

    await expect(
      approveWithdrawal(ADMIN_ID, REQUEST_ID, IP)
    ).rejects.toMatchObject({ code: "RECONCILIATION_FAILED" });
  });
});

// ---------------------------------------------------------------------------
// 11–13. completeWithdrawal
// ---------------------------------------------------------------------------

describe("completeWithdrawal — happy path", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sets status COMPLETED and processedAt", async () => {
    vi.mocked(prisma.withdrawalRequest.findUnique).mockResolvedValue(
      MOCK_REQUEST_APPROVED as never
    );
    vi.mocked(prisma.withdrawalRequest.update).mockResolvedValue({} as never);

    await completeWithdrawal(ADMIN_ID, REQUEST_ID);

    expect(prisma.withdrawalRequest.update).toHaveBeenCalledOnce();
    const updateArgs = vi.mocked(prisma.withdrawalRequest.update).mock
      .calls[0]?.[0];
    expect(updateArgs?.where?.id).toBe(REQUEST_ID);
    expect(updateArgs?.data?.status).toBe("COMPLETED");
    expect(updateArgs?.data?.processedAt).toBeInstanceOf(Date);
  });
});

describe("completeWithdrawal — error paths", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws REQUEST_NOT_FOUND when request does not exist", async () => {
    vi.mocked(prisma.withdrawalRequest.findUnique).mockResolvedValue(
      null as never
    );

    await expect(
      completeWithdrawal(ADMIN_ID, REQUEST_ID)
    ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
    expect(prisma.withdrawalRequest.update).not.toHaveBeenCalled();
  });

  it("throws REQUEST_NOT_APPROVED when request is still PENDING", async () => {
    vi.mocked(prisma.withdrawalRequest.findUnique).mockResolvedValue(
      MOCK_REQUEST_PENDING as never
    );

    await expect(
      completeWithdrawal(ADMIN_ID, REQUEST_ID)
    ).rejects.toMatchObject({ code: "REQUEST_NOT_APPROVED" });
    expect(prisma.withdrawalRequest.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 14–16. rejectWithdrawal
// ---------------------------------------------------------------------------

describe("rejectWithdrawal — happy path", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sets status REJECTED and creates audit log", async () => {
    vi.mocked(prisma.withdrawalRequest.findUnique).mockResolvedValue(
      MOCK_REQUEST_PENDING as never
    );
    vi.mocked(prisma.withdrawalRequest.update).mockResolvedValue({} as never);
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as never);

    await rejectWithdrawal(ADMIN_ID, REQUEST_ID, IP);

    expect(prisma.withdrawalRequest.update).toHaveBeenCalledOnce();
    const updateArgs = vi.mocked(prisma.withdrawalRequest.update).mock
      .calls[0]?.[0];
    expect(updateArgs?.where?.id).toBe(REQUEST_ID);
    expect(updateArgs?.data?.status).toBe("REJECTED");
    expect(updateArgs?.data?.adminId).toBe(ADMIN_ID);

    expect(prisma.adminAuditLog.create).toHaveBeenCalledOnce();
    const auditData = vi.mocked(prisma.adminAuditLog.create).mock
      .calls[0]?.[0]?.data;
    expect(auditData?.action).toBe("REJECT_WITHDRAWAL");
    expect(auditData?.adminId).toBe(ADMIN_ID);
    expect(auditData?.targetId).toBe(REQUEST_ID);
    expect(auditData?.ipAddress).toBe(IP);
  });

  it("does NOT insert any Transaction (no balance change on reject)", async () => {
    vi.mocked(prisma.withdrawalRequest.findUnique).mockResolvedValue(
      MOCK_REQUEST_PENDING as never
    );
    vi.mocked(prisma.withdrawalRequest.update).mockResolvedValue({} as never);
    vi.mocked(prisma.adminAuditLog.create).mockResolvedValue({} as never);

    await rejectWithdrawal(ADMIN_ID, REQUEST_ID, IP);

    // $transaction should never be called on reject
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("rejectWithdrawal — error paths", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws REQUEST_NOT_FOUND when request does not exist", async () => {
    vi.mocked(prisma.withdrawalRequest.findUnique).mockResolvedValue(
      null as never
    );

    await expect(
      rejectWithdrawal(ADMIN_ID, REQUEST_ID, IP)
    ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
  });

  it("throws REQUEST_NOT_PENDING when request is already APPROVED", async () => {
    vi.mocked(prisma.withdrawalRequest.findUnique).mockResolvedValue(
      MOCK_REQUEST_APPROVED as never
    );

    await expect(
      rejectWithdrawal(ADMIN_ID, REQUEST_ID, IP)
    ).rejects.toMatchObject({ code: "REQUEST_NOT_PENDING" });
    expect(prisma.withdrawalRequest.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 17–18. listPendingWithdrawals / getUserWithdrawals
// ---------------------------------------------------------------------------

describe("listPendingWithdrawals", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls findMany with status PENDING and returns amount as number", async () => {
    vi.mocked(prisma.withdrawalRequest.findMany).mockResolvedValue([
      {
        id: REQUEST_ID,
        amount: { toNumber: () => 50 } as never,
        venmoHandle: "@alice",
        zelleContact: null,
        status: "PENDING",
        createdAt: new Date("2026-03-27T00:00:00Z"),
        user: { id: USER_ID, name: "Alice", phone: "+1555" },
      } as never,
    ]);

    const result = await listPendingWithdrawals();

    expect(prisma.withdrawalRequest.findMany).toHaveBeenCalledOnce();
    const args = vi.mocked(prisma.withdrawalRequest.findMany).mock.calls[0]?.[0];
    expect(args?.where?.status).toBe("PENDING");

    expect(result[0]?.amount).toBe(50);
    expect(typeof result[0]?.amount).toBe("number");
  });
});

describe("getUserWithdrawals", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls findMany with userId filter and returns amount as number", async () => {
    vi.mocked(prisma.withdrawalRequest.findMany).mockResolvedValue([
      {
        id: REQUEST_ID,
        amount: { toNumber: () => 25 } as never,
        venmoHandle: "@alice",
        zelleContact: null,
        status: "COMPLETED",
        createdAt: new Date("2026-03-27T00:00:00Z"),
        processedAt: new Date("2026-03-27T01:00:00Z"),
      } as never,
    ]);

    const result = await getUserWithdrawals(USER_ID);

    expect(prisma.withdrawalRequest.findMany).toHaveBeenCalledOnce();
    const args = vi.mocked(prisma.withdrawalRequest.findMany).mock.calls[0]?.[0];
    expect(args?.where?.userId).toBe(USER_ID);

    expect(result[0]?.amount).toBe(25);
    expect(typeof result[0]?.amount).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// WithdrawalError — class behaviour
// ---------------------------------------------------------------------------

describe("WithdrawalError", () => {
  it("is an instance of Error with name WithdrawalError", () => {
    const err = new WithdrawalError("INVALID_AMOUNT", "bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WithdrawalError);
    expect(err.name).toBe("WithdrawalError");
    expect(err.code).toBe("INVALID_AMOUNT");
    expect(err.message).toBe("bad input");
  });
});
