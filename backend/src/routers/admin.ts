/**
 * Admin tRPC Router — Task 2.3
 *
 * All procedures require admin role (enforced by adminProcedure middleware).
 *
 * Endpoints:
 *   admin.reconciliation  — Run ledger reconciliation check.
 *   admin.chainIntegrity  — Verify SHA-256 hash chain integrity.
 *   admin.auditLog        — Paginated admin audit log.
 *   admin.dashboard       — Aggregate stats for admin dashboard.
 *
 * References:
 *   PRD §5.2 — Admin views
 *   PRD §7.4 — Immutable ledger guarantees
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, adminProcedure } from "../trpc.js";
import { runReconciliation, getTotalDeposits, getNetCharityAmount } from "../services/ledger.js";
import { verifyChainIntegrity } from "../services/hashChainVerifier.js";
import { getRecentAuditLog } from "../services/auditLog.js";
import { prisma } from "../db.js";
import { maxHouseExposure, adaptiveB } from "../services/lmsr.js";
import { Decimal } from "decimal.js";

// ---------------------------------------------------------------------------
// Admin router
// ---------------------------------------------------------------------------

export const adminRouter = router({
  // -------------------------------------------------------------------------
  // admin.reconciliation
  // Run the reconciliation invariant check and return a detailed result.
  // -------------------------------------------------------------------------
  reconciliation: adminProcedure.query(async () => {
    try {
      const result = await runReconciliation();
      return {
        isBalanced: result.isBalanced,
        totalDeposits: result.totalDeposits.toFixed(6),
        totalUserBalances: result.totalUserBalances.toFixed(6),
        charityPool: result.charityPool.toFixed(6),
        stripeFees: result.stripeFees.toFixed(6),
        netCharityAmount: result.netCharityAmount.toFixed(6),
        withdrawalsPaid: result.withdrawalsPaid.toFixed(6),
        housePool: result.housePool.toFixed(6),
        checkedAt: result.checkedAt.toISOString(),
      };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Reconciliation check failed",
        cause: err,
      });
    }
  }),

  // -------------------------------------------------------------------------
  // admin.chainIntegrity
  // Recompute every txHash in the ledger and verify the hash chain.
  // -------------------------------------------------------------------------
  chainIntegrity: adminProcedure.query(async () => {
    try {
      const result = await verifyChainIntegrity();
      return {
        valid: result.valid,
        checkedCount: result.checkedCount,
        firstBadTransactionId: result.firstBadTransactionId ?? null,
        error: result.error ?? null,
        checkedAt: result.checkedAt.toISOString(),
      };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Chain integrity check failed",
        cause: err,
      });
    }
  }),

  // -------------------------------------------------------------------------
  // admin.auditLog
  // Return recent admin audit log entries (newest first), paginated.
  // -------------------------------------------------------------------------
  auditLog: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().uuid().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const page = await getRecentAuditLog(input.limit, input.cursor);
        return {
          entries: page.entries.map((e) => ({
            id: e.id,
            adminId: e.adminId,
            action: e.action,
            targetId: e.targetId,
            metadata: e.metadata,
            ipAddress: e.ipAddress,
            createdAt: e.createdAt.toISOString(),
          })),
          nextCursor: page.nextCursor,
        };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch audit log",
          cause: err,
        });
      }
    }),

  // -------------------------------------------------------------------------
  // admin.dashboard
  // Aggregate stats: total volume, active users, house exposure, charity pool.
  // -------------------------------------------------------------------------
  dashboard: adminProcedure.query(async () => {
    try {
      const [
        totalDeposits,
        totalUsersResult,
        activeMarketsResult,
        reconciliation,
      ] = await Promise.all([
        getTotalDeposits(),
        prisma.user.count(),
        prisma.market.findMany({
          where: { status: "ACTIVE" },
          include: {
            outcomes: { select: { sharesSold: true } },
            purchases: { select: { cost: true } },
          },
        }),
        runReconciliation(),
      ]);

      // Compute total volume and per-market worst-case house exposure.
      let totalVolume = new Decimal(0);
      let totalHouseExposure = new Decimal(0);

      const marketExposures = activeMarketsResult.map(
        (market: (typeof activeMarketsResult)[number]) => {
        const marketVolume = market.purchases.reduce(
          (sum: Decimal, p: { cost: Decimal }) => sum.plus(p.cost),
          new Decimal(0)
        );
        totalVolume = totalVolume.plus(marketVolume);

        const dtMs = market.openedAt
          ? Date.now() - market.openedAt.getTime()
          : 0;
        const bFloor = market.bFloorOverride
          ? Number(market.bFloorOverride)
          : 20;
        const b = adaptiveB(bFloor, dtMs, marketVolume.toNumber());
        const exposure = new Decimal(
          maxHouseExposure(b, Math.max(market.outcomes.length, 2))
        );
        totalHouseExposure = totalHouseExposure.plus(exposure);

        return {
          marketId: market.id,
          question: market.question,
          volume: marketVolume.toFixed(2),
          worstCaseLoss: exposure.toFixed(2),
          b: b.toFixed(2),
        };
      });

      return {
        totalDeposits: totalDeposits.toFixed(2),
        totalUsers: totalUsersResult,
        activeMarketCount: activeMarketsResult.length,
        totalVolume: totalVolume.toFixed(2),
        totalHouseExposure: totalHouseExposure.toFixed(2),
        /** Gross charity pool: total 20% fees collected across all market resolutions. */
        charityPool: reconciliation.charityPool.toFixed(2),
        /** Gross alias — same as charityPool, explicit for dashboard clarity. */
        grossCharityPool: reconciliation.charityPool.toFixed(2),
        /** Total Stripe processing fees absorbed from the charity pool. */
        stripeFees: reconciliation.stripeFees.toFixed(2),
        /** Net charity amount available for donation = grossCharityPool − stripeFees. */
        netCharityAmount: reconciliation.netCharityAmount.toFixed(2),
        housePool: reconciliation.housePool.toFixed(2),
        totalUserBalances: reconciliation.totalUserBalances.toFixed(2),
        isReconciled: reconciliation.isBalanced,
        marketExposures,
      };
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to build dashboard",
        cause: err,
      });
    }
  }),

  // -------------------------------------------------------------------------
  // admin.listUsers — all users with balance info
  // -------------------------------------------------------------------------
  listUsers: adminProcedure.query(async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        phone: true,
        name: true,
        country: true,
        role: true,
        createdAt: true,
        _count: { select: { purchases: true } },
      },
    });

    const balances = await prisma.$queryRaw<
      Array<{ user_id: string; balance: string }>
    >`
      SELECT
        user_id,
        COALESCE(
          SUM(CASE WHEN credit_account = 'user:' || user_id THEN amount ELSE 0 END) -
          SUM(CASE WHEN debit_account  = 'user:' || user_id THEN amount ELSE 0 END),
          0
        ) AS balance
      FROM transactions
      GROUP BY user_id
    `;

    const balanceMap = new Map(
      balances.map((b) => [b.user_id, parseFloat(b.balance)])
    );

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      country: u.country,
      role: u.role.toLowerCase() as "guest" | "admin",
      totalBets: u._count.purchases,
      suspicious: false,
      balanceCents: Math.round((balanceMap.get(u.id) ?? 0) * 100),
      createdAt: u.createdAt.toISOString(),
    }));
  }),

  // -------------------------------------------------------------------------
  // admin.listWithdrawals — all withdrawal requests
  // -------------------------------------------------------------------------
  listWithdrawals: adminProcedure.query(async () => {
    const withdrawals = await prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, phone: true } },
        admin: { select: { name: true } },
      },
    });

    return withdrawals.map((w) => ({
      id: w.id,
      userName: w.user.name,
      userPhone: w.user.phone,
      amountCents: Math.round(Number(w.amount) * 100),
      venmoHandle: w.venmoHandle,
      zelleContact: w.zelleContact,
      status: w.status.toLowerCase() as "pending" | "approved" | "rejected" | "completed",
      adminName: w.admin?.name ?? null,
      createdAt: w.createdAt.toISOString(),
      processedAt: w.processedAt?.toISOString() ?? null,
    }));
  }),
});
