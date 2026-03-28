/**
 * Withdrawal Service — PRD §7.3
 *
 * Manual payout flow:
 *   Guest requests withdrawal (PENDING) →
 *   Admin approves (APPROVED + ledger WITHDRAWAL transaction debit) →
 *   Admin marks sent (COMPLETED)
 *   — or —
 *   Admin rejects (REJECTED, no balance change)
 *
 * Critical rule (PRD §9 rule 10): total withdrawals can never exceed total deposits.
 * Enforced by the reconciliation invariant check inside approveWithdrawal().
 */

import { Decimal } from "decimal.js";
import { prisma } from "../db.js";
import { computeHash } from "./hashChain.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce any Postgres/Prisma numeric return to a plain JS number. */
function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string") return parseFloat(val) || 0;
  if (typeof val === "object" && "toNumber" in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return parseFloat(String(val)) || 0;
}

/**
 * Conservation invariant (PRD §7.4) — same formula as purchaseEngine.
 * Throws WithdrawalError('RECONCILIATION_FAILED') on mismatch > $0.0001.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runReconciliation(tx: any): Promise<void> {
  const result = (await tx.$queryRaw`
    SELECT
      COALESCE(
        SUM(CASE WHEN credit_account LIKE 'user:%' THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  LIKE 'user:%' THEN amount ELSE 0 END),
        0
      ) AS user_balances,
      COALESCE(
        SUM(CASE WHEN credit_account = 'house_amm' THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  = 'house_amm' THEN amount ELSE 0 END),
        0
      ) AS house_amm,
      COALESCE(
        SUM(CASE WHEN credit_account = 'charity_pool' THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  = 'charity_pool' THEN amount ELSE 0 END),
        0
      ) AS charity_pool,
      COALESCE(SUM(CASE WHEN type = 'DEPOSIT'    THEN amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) AS total_withdrawals
    FROM transactions
  `) as Array<{
    user_balances: unknown;
    house_amm: unknown;
    charity_pool: unknown;
    total_deposits: unknown;
    total_withdrawals: unknown;
  }>;

  const row = result[0];
  if (!row) return; // Empty ledger — trivially balanced.

  const userBalances = toNumber(row.user_balances);
  const houseAmm = toNumber(row.house_amm);
  const charityPool = toNumber(row.charity_pool);
  const totalDeposits = toNumber(row.total_deposits);
  const totalWithdrawals = toNumber(row.total_withdrawals);

  const lhs = userBalances + houseAmm + charityPool + totalWithdrawals;
  const rhs = totalDeposits;
  const diff = Math.abs(lhs - rhs);

  if (diff > 0.0001) {
    throw new WithdrawalError(
      "RECONCILIATION_FAILED",
      `Reconciliation failed: lhs=${lhs.toFixed(6)} rhs=${rhs.toFixed(6)} diff=${diff.toFixed(6)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Structured error thrown by all withdrawal service functions. */
export class WithdrawalError extends Error {
  constructor(
    public readonly code:
      | "INVALID_AMOUNT"
      | "NO_CONTACT_METHOD"
      | "INSUFFICIENT_BALANCE"
      | "REQUEST_NOT_FOUND"
      | "REQUEST_NOT_PENDING"
      | "REQUEST_NOT_APPROVED"
      | "RECONCILIATION_FAILED",
    message: string
  ) {
    super(message);
    this.name = "WithdrawalError";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a PENDING withdrawal request.
 *
 * Validates:
 *  - amountCents is a positive integer
 *  - at least one of venmoHandle / zelleContact is provided
 *  - user's ledger balance >= amount requested
 *
 * Note: the balance check here is advisory — the definitive check runs inside
 * approveWithdrawal() within an atomic transaction.
 *
 * @param userId       - UUID of the requesting user
 * @param amountCents  - Amount in integer cents (e.g. 1000 = $10.00)
 * @param venmoHandle  - Optional Venmo @handle
 * @param zelleContact - Optional Zelle email or phone number
 */
export async function requestWithdrawal(
  userId: string,
  amountCents: number,
  venmoHandle?: string,
  zelleContact?: string
): Promise<{ requestId: string }> {
  // --------------------------------------------------------------------------
  // Input validation
  // --------------------------------------------------------------------------
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new WithdrawalError(
      "INVALID_AMOUNT",
      `amountCents must be a positive integer; got ${amountCents}`
    );
  }

  if (!venmoHandle && !zelleContact) {
    throw new WithdrawalError(
      "NO_CONTACT_METHOD",
      "At least one of venmoHandle or zelleContact is required"
    );
  }

  const amountDollars = amountCents / 100;
  const userAccount = `user:${userId}`;

  // --------------------------------------------------------------------------
  // Advisory balance check (pre-flight, outside transaction)
  // --------------------------------------------------------------------------
  const balanceResult = await prisma.$queryRaw<Array<{ balance: unknown }>>`
    SELECT
      COALESCE(
        SUM(CASE WHEN credit_account = ${userAccount} THEN amount ELSE 0 END)
        - SUM(CASE WHEN debit_account  = ${userAccount} THEN amount ELSE 0 END),
        0
      ) AS balance
    FROM transactions
  `;

  const balanceDollars = toNumber(balanceResult[0]?.balance ?? 0);

  if (balanceDollars < amountDollars) {
    throw new WithdrawalError(
      "INSUFFICIENT_BALANCE",
      `Insufficient balance: have $${balanceDollars.toFixed(2)}, need $${amountDollars.toFixed(2)}`
    );
  }

  // --------------------------------------------------------------------------
  // Create withdrawal request
  // --------------------------------------------------------------------------
  const request = await prisma.withdrawalRequest.create({
    data: {
      userId,
      amount: new Decimal(amountDollars),
      venmoHandle: venmoHandle ?? null,
      zelleContact: zelleContact ?? null,
      status: "PENDING",
    },
  });

  return { requestId: request.id };
}

/**
 * Admin approves a PENDING withdrawal request.
 *
 * Atomically:
 *  1. Validates request is PENDING
 *  2. Re-checks user balance inside the transaction
 *  3. INSERTs a WITHDRAWAL transaction (debits user balance)
 *  4. Updates withdrawal request status to APPROVED
 *  5. Creates admin audit log entry
 *  6. Runs reconciliation invariant check
 *
 * @param adminId   - UUID of the approving admin
 * @param requestId - UUID of the WithdrawalRequest row
 * @param ipAddress - Admin's IP address for audit log
 */
export async function approveWithdrawal(
  adminId: string,
  requestId: string,
  ipAddress: string
): Promise<{ transactionId: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.$transaction as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<{ transactionId: string }> => {
      // ----------------------------------------------------------------------
      // 1. Fetch and validate request
      // ----------------------------------------------------------------------
      const request = (await tx.withdrawalRequest.findUnique({
        where: { id: requestId },
        select: { id: true, userId: true, amount: true, status: true },
      })) as { id: string; userId: string; amount: unknown; status: string } | null;

      if (!request) {
        throw new WithdrawalError(
          "REQUEST_NOT_FOUND",
          `WithdrawalRequest ${requestId} not found`
        );
      }

      if (request.status !== "PENDING") {
        throw new WithdrawalError(
          "REQUEST_NOT_PENDING",
          `WithdrawalRequest ${requestId} is ${request.status}, expected PENDING`
        );
      }

      const amountDollars = toNumber(request.amount);
      const { userId } = request;
      const userAccount = `user:${userId}`;

      // ----------------------------------------------------------------------
      // 2. Definitive balance check inside transaction
      // ----------------------------------------------------------------------
      const balanceResult = (await tx.$queryRaw`
        SELECT
          COALESCE(
            SUM(CASE WHEN credit_account = ${userAccount} THEN amount ELSE 0 END)
            - SUM(CASE WHEN debit_account  = ${userAccount} THEN amount ELSE 0 END),
            0
          ) AS balance
        FROM transactions
      `) as Array<{ balance: unknown }>;

      const balanceDollars = toNumber(balanceResult[0]?.balance ?? 0);

      // ----------------------------------------------------------------------
      // 2b. Charity fee calculation (20% of lifetime profit, deducted at
      //     cash-out time — PRD §7.5)
      // ----------------------------------------------------------------------
      const userTotalsResult = (await tx.$queryRaw`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'DEPOSIT'     THEN amount ELSE 0 END), 0) AS total_deposits,
          COALESCE(SUM(CASE WHEN type = 'CHARITY_FEE' THEN amount ELSE 0 END), 0) AS past_charity_paid,
          COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL'  THEN amount ELSE 0 END), 0) AS past_withdrawals
        FROM transactions
        WHERE user_id = ${userId}::uuid
      `) as Array<{
        total_deposits: unknown;
        past_charity_paid: unknown;
        past_withdrawals: unknown;
      }>;

      const totalDeposits   = new Decimal(toNumber(userTotalsResult[0]?.total_deposits   ?? 0));
      const pastCharityPaid = new Decimal(toNumber(userTotalsResult[0]?.past_charity_paid ?? 0));
      const pastWithdrawals = new Decimal(toNumber(userTotalsResult[0]?.past_withdrawals  ?? 0));
      const balanceDecimal  = new Decimal(balanceDollars);
      const amountDecimal   = new Decimal(amountDollars);

      // profit = current_balance + past_withdrawals + past_charity_paid − total_deposits
      // (reconstructs lifetime net gain; charity is owed on that gain, not on return of principal)
      const profit = balanceDecimal
        .plus(pastWithdrawals)
        .plus(pastCharityPaid)
        .minus(totalDeposits);

      const charityOwed      = profit.greaterThan(0) ? profit.times("0.2") : new Decimal(0);
      const charityRemaining = Decimal.max(new Decimal(0), charityOwed.minus(pastCharityPaid));

      // Balance must cover both the withdrawal and any outstanding charity fee.
      if (balanceDecimal.lessThan(amountDecimal.plus(charityRemaining))) {
        throw new WithdrawalError(
          "INSUFFICIENT_BALANCE",
          `Insufficient balance at approval: have $${balanceDollars.toFixed(2)}, ` +
          `need $${amountDecimal.plus(charityRemaining).toFixed(2)} ` +
          `(withdrawal $${amountDecimal.toFixed(2)} + charity $${charityRemaining.toFixed(2)})`
        );
      }

      // ----------------------------------------------------------------------
      // 3. Hash chain: fetch current chain tip
      // ----------------------------------------------------------------------
      const lastTx = (await tx.transaction.findFirst({
        orderBy: { createdAt: "desc" },
        select: { txHash: true },
      })) as { txHash: string } | null;

      let prevHash = lastTx?.txHash ?? "0".repeat(64);
      const now = new Date();

      // ----------------------------------------------------------------------
      // 3a. Optional CHARITY_FEE transaction — debit user → credit charity_pool
      //     Must be inserted BEFORE the WITHDRAWAL so the hash chain is correct.
      // ----------------------------------------------------------------------
      if (charityRemaining.greaterThan(0)) {
        const charityNow  = now; // same millisecond; ordering guaranteed by prevHash chain
        const charityHash = computeHash(
          prevHash,
          "CHARITY_FEE",
          charityRemaining.toFixed(6),
          userId,
          charityNow.toISOString()
        );

        await tx.transaction.create({
          data: {
            userId,
            debitAccount:  userAccount,
            creditAccount: "charity_pool",
            type:          "CHARITY_FEE",
            amount:        charityRemaining,
            prevHash,
            txHash:        charityHash,
            createdAt:     charityNow,
          },
        });

        // Advance the chain tip to the just-inserted CHARITY_FEE.
        prevHash = charityHash;
      }

      // ----------------------------------------------------------------------
      // 4. INSERT WITHDRAWAL transaction (debits user balance)
      //    Double-entry: debit user account, credit withdrawal_paid
      //    When a CHARITY_FEE was inserted, use +1 ms to guarantee createdAt
      //    ordering so the background chain verifier processes rows in sequence.
      // ----------------------------------------------------------------------
      const withdrawalNow = charityRemaining.greaterThan(0)
        ? new Date(now.getTime() + 1)
        : now;

      const txHash = computeHash(
        prevHash,
        "WITHDRAWAL",
        amountDollars.toFixed(6),
        userId,
        withdrawalNow.toISOString()
      );

      const txRecord = (await tx.transaction.create({
        data: {
          userId,
          debitAccount:  userAccount,
          creditAccount: "withdrawal_paid",
          type:          "WITHDRAWAL",
          amount:        new Decimal(amountDollars),
          prevHash,
          txHash,
          createdAt:     withdrawalNow,
        },
      })) as { id: string };

      // ----------------------------------------------------------------------
      // 5. Update withdrawal request to APPROVED
      // ----------------------------------------------------------------------
      await tx.withdrawalRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED", adminId },
      });

      // ----------------------------------------------------------------------
      // 6. Admin audit log
      // ----------------------------------------------------------------------
      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: "APPROVE_WITHDRAWAL",
          targetId: requestId,
          metadata: {
            userId,
            amountDollars,
            charityFeeDollars: charityRemaining.toNumber(),
            transactionId: txRecord.id,
          },
          ipAddress,
        },
      });

      // ----------------------------------------------------------------------
      // 7. Reconciliation invariant check — ROLLBACK on failure
      // ----------------------------------------------------------------------
      await runReconciliation(tx);

      return { transactionId: txRecord.id };
    },
    { isolationLevel: "Serializable", timeout: 10_000 }
  );
}

/**
 * Admin marks an APPROVED withdrawal as COMPLETED (money physically sent).
 * Sets processedAt = now. No balance change (already debited on approve).
 *
 * @param adminId   - UUID of the completing admin (accepted for consistency, not persisted)
 * @param requestId - UUID of the WithdrawalRequest row
 */
export async function completeWithdrawal(
  adminId: string,
  requestId: string
): Promise<void> {
  // Suppress unused param warning — adminId accepted for API consistency
  void adminId;

  const request = await prisma.withdrawalRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true },
  });

  if (!request) {
    throw new WithdrawalError(
      "REQUEST_NOT_FOUND",
      `WithdrawalRequest ${requestId} not found`
    );
  }

  if (request.status !== "APPROVED") {
    throw new WithdrawalError(
      "REQUEST_NOT_APPROVED",
      `WithdrawalRequest ${requestId} is ${request.status}, expected APPROVED`
    );
  }

  await prisma.withdrawalRequest.update({
    where: { id: requestId },
    data: { status: "COMPLETED", processedAt: new Date() },
  });
}

/**
 * Admin rejects a PENDING withdrawal request.
 * No balance change — the user keeps their funds.
 *
 * @param adminId   - UUID of the rejecting admin
 * @param requestId - UUID of the WithdrawalRequest row
 * @param ipAddress - Admin's IP address for audit log
 */
export async function rejectWithdrawal(
  adminId: string,
  requestId: string,
  ipAddress: string
): Promise<void> {
  const request = await prisma.withdrawalRequest.findUnique({
    where: { id: requestId },
    select: { id: true, userId: true, amount: true, status: true },
  });

  if (!request) {
    throw new WithdrawalError(
      "REQUEST_NOT_FOUND",
      `WithdrawalRequest ${requestId} not found`
    );
  }

  if (request.status !== "PENDING") {
    throw new WithdrawalError(
      "REQUEST_NOT_PENDING",
      `WithdrawalRequest ${requestId} is ${request.status}, expected PENDING`
    );
  }

  await prisma.withdrawalRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", adminId },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: "REJECT_WITHDRAWAL",
      targetId: requestId,
      metadata: {
        userId: request.userId,
        amountDollars: toNumber(request.amount),
      },
      ipAddress,
    },
  });
}

// ---------------------------------------------------------------------------
// Public return types (amount normalised to number for clean JSON serialisation)
// ---------------------------------------------------------------------------

export interface PendingWithdrawalRow {
  id: string;
  amount: number;
  venmoHandle: string | null;
  zelleContact: string | null;
  status: string;
  createdAt: Date;
  user: { id: string; name: string; phone: string };
}

export interface UserWithdrawalRow {
  id: string;
  amount: number;
  venmoHandle: string | null;
  zelleContact: string | null;
  status: string;
  createdAt: Date;
  processedAt: Date | null;
}

/**
 * List all PENDING withdrawal requests, ordered by creation time (oldest first).
 * For the admin queue view (PRD §5.2 — Withdrawal Queue).
 */
export async function listPendingWithdrawals(): Promise<PendingWithdrawalRow[]> {
  const rows = await prisma.withdrawalRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amount: true,
      venmoHandle: true,
      zelleContact: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, name: true, phone: true } },
    },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    ...r,
    amount: toNumber(r.amount),
  }));
}

/**
 * Get full withdrawal history for a user (newest first).
 *
 * @param userId - UUID of the user
 */
export async function getUserWithdrawals(
  userId: string
): Promise<UserWithdrawalRow[]> {
  const rows = await prisma.withdrawalRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      amount: true,
      venmoHandle: true,
      zelleContact: true,
      status: true,
      createdAt: true,
      processedAt: true,
    },
  });
  return rows.map((r: (typeof rows)[number]) => ({
    ...r,
    amount: toNumber(r.amount),
  }));
}
