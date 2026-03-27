/**
 * Admin tRPC Router — Task 2.3
 *
 * All endpoints require the admin role (enforced by adminProcedure middleware).
 *
 * Endpoints:
 *   admin.reconciliation  — run the conservation invariant check
 *   admin.chainIntegrity  — verify the SHA-256 hash chain
 *   admin.auditLog        — list admin audit log entries (paginated)
 *   admin.dashboard       — aggregate stats: volume, users, pools, exposure
 *
 * References:
 *   PRD §5.2 — admin views
 *   PRD §7.4 — immutable ledger guarantees
 *   PRD §9   — rule 11: read-only mode on chain failure
 */

import { z } from "zod";
import { router, adminProcedure } from "../trpc.js";
import { runReconciliation } from "../services/ledger.js";
import { verifyChainIntegrity } from "../services/hashChainVerifier.js";
import { maxHouseExposure, adaptiveB } from "../services/lmsr.js";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Coerce any Postgres / Prisma numeric return to a plain JS number. */
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminRouter = router({
  /**
   * admin.reconciliation
   *
   * Runs the double-entry conservation invariant (PRD §7.4):
   *   SUM(user balances) + SUM(house_amm) + SUM(charity_pool) + SUM(withdrawals)
   *     = SUM(deposits)
   *
   * Returns the full breakdown plus a `valid` flag.
   */
  reconciliation: adminProcedure.query(async () => {
    const r = await runReconciliation();
    return {
      valid: r.valid,
      userBalancesDollars: Math.round(r.userBalances * 100) / 100,
      houseAmmDollars: Math.round(r.houseAmm * 100) / 100,
      charityPoolDollars: Math.round(r.charityPool * 100) / 100,
      totalDepositsDollars: Math.round(r.totalDeposits * 100) / 100,
      totalWithdrawalsDollars: Math.round(r.totalWithdrawals * 100) / 100,
      lhsDollars: Math.round(r.lhs * 100) / 100,
      rhsDollars: Math.round(r.rhs * 100) / 100,
      diffDollars: r.diff,
      checkedAt: new Date().toISOString(),
    };
  }),

  /**
   * admin.chainIntegrity
   *
   * Re-runs the SHA-256 hash chain verification across all transaction rows.
   * Returns whether the chain is intact and, on failure, which row broke it.
   */
  chainIntegrity: adminProcedure.query(async () => {
    const r = await verifyChainIntegrity();
    return {
      valid: r.valid,
      totalChecked: r.totalChecked,
      brokenAtId: r.brokenAtId ?? null,
      brokenAtSequence: r.brokenAtSequence ?? null,
      error: r.error ?? null,
      checkedAt: new Date().toISOString(),
    };
  }),

  /**
   * admin.auditLog
   *
   * Returns paginated admin audit log entries, newest first.
   * Optionally filter by a specific admin user.
   */
  auditLog: adminProcedure
    .input(
      z.object({
        limit: z.number().int().positive().max(100).default(50),
        offset: z.number().int().nonnegative().default(0),
        /** Filter to a specific admin's actions. */
        adminId: z.string().uuid().optional(),
      })
    )
    .query(async ({ input }) => {
      const where = input.adminId ? { adminId: input.adminId } : undefined;

      const [entries, total] = await Promise.all([
        prisma.adminAuditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: input.limit,
          skip: input.offset,
          select: {
            id: true,
            adminId: true,
            action: true,
            targetId: true,
            metadata: true,
            ipAddress: true,
            createdAt: true,
            admin: {
              select: { name: true },
            },
          },
        }),
        prisma.adminAuditLog.count({ where }),
      ]);

      type AuditEntry = {
        id: string;
        adminId: string;
        action: string;
        targetId: string;
        metadata: unknown;
        ipAddress: string;
        createdAt: Date;
        admin: { name: string };
      };

      return {
        entries: (entries as AuditEntry[]).map((e) => ({
          id: e.id,
          adminId: e.adminId,
          adminName: e.admin.name,
          action: e.action,
          targetId: e.targetId,
          metadata: e.metadata,
          ipAddress: e.ipAddress,
          createdAt: e.createdAt,
        })),
        total,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * admin.dashboard
   *
   * Aggregate stats for the admin overview panel (PRD §5.2):
   *   - Total volume (sum of all purchase costs)
   *   - Total deposits and withdrawals
   *   - House AMM pool and charity pool balances
   *   - User count
   *   - Active market count and worst-case house exposure (using maxHouseExposure)
   *   - Pending withdrawal count
   */
  dashboard: adminProcedure.query(async () => {
    type StatsRow = {
      total_volume: unknown;
      total_deposits: unknown;
      total_withdrawals: unknown;
      house_amm: unknown;
      charity_pool: unknown;
    };

    const [statsRows, userCount, activeMarkets, pendingWithdrawalCount] =
      await Promise.all([
        prisma.$queryRaw<StatsRow[]>`
          SELECT
            COALESCE(SUM(CASE WHEN type = 'PURCHASE'   THEN amount ELSE 0 END), 0) AS total_volume,
            COALESCE(SUM(CASE WHEN type = 'DEPOSIT'    THEN amount ELSE 0 END), 0) AS total_deposits,
            COALESCE(SUM(CASE WHEN type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) AS total_withdrawals,
            COALESCE(
              SUM(CASE WHEN credit_account = 'house_amm' THEN amount ELSE 0 END)
              - SUM(CASE WHEN debit_account  = 'house_amm' THEN amount ELSE 0 END),
              0
            ) AS house_amm,
            COALESCE(
              SUM(CASE WHEN credit_account = 'charity_pool' THEN amount ELSE 0 END)
              - SUM(CASE WHEN debit_account  = 'charity_pool' THEN amount ELSE 0 END),
              0
            ) AS charity_pool
          FROM transactions
        `,

        prisma.user.count(),

        prisma.market.findMany({
          where: { status: "ACTIVE" },
          select: {
            id: true,
            question: true,
            bFloorOverride: true,
            openedAt: true,
            _count: { select: { outcomes: true } },
          },
          include: {
            purchases: { select: { cost: true } },
          },
        }),

        prisma.withdrawalRequest.count({ where: { status: "PENDING" } }),
      ]);

    const stats = statsRows[0];
    const totalVolumeDollars = toNumber(stats?.total_volume ?? 0);
    const totalDepositsDollars = toNumber(stats?.total_deposits ?? 0);
    const totalWithdrawalsDollars = toNumber(stats?.total_withdrawals ?? 0);
    const houseAmmDollars = toNumber(stats?.house_amm ?? 0);
    const charityPoolDollars = toNumber(stats?.charity_pool ?? 0);

    type ActiveMarket = {
      id: string;
      question: string;
      bFloorOverride: unknown | null;
      openedAt: Date | null;
      _count: { outcomes: number };
      purchases: Array<{ cost: unknown }>;
    };

    // Worst-case house exposure per market using the real LMSR formula.
    const marketExposure = (activeMarkets as ActiveMarket[]).map((m) => {
      const bFloor =
        m.bFloorOverride !== null ? toNumber(m.bFloorOverride) : 20;
      const n = m._count.outcomes;
      const volumeDollars = m.purchases.reduce(
        (sum: number, p: { cost: unknown }) => sum + toNumber(p.cost),
        0
      );
      const dtMs = m.openedAt ? Date.now() - m.openedAt.getTime() : 0;
      const b = adaptiveB(bFloor, dtMs, volumeDollars);
      const worstCaseLoss = n >= 2 ? maxHouseExposure(b, n) : 0;

      return {
        marketId: m.id,
        question: m.question,
        outcomeCount: n,
        volumeCents: Math.round(volumeDollars * 100),
        bValue: Math.round(b * 100) / 100,
        worstCaseLossCents: Math.round(worstCaseLoss * 100),
      };
    });

    const totalExposureCents = marketExposure.reduce(
      (sum: number, m: { worstCaseLossCents: number }) =>
        sum + m.worstCaseLossCents,
      0
    );

    return {
      totalVolumeCents: Math.round(totalVolumeDollars * 100),
      totalDepositsCents: Math.round(totalDepositsDollars * 100),
      totalWithdrawalsCents: Math.round(totalWithdrawalsDollars * 100),
      houseAmmCents: Math.round(houseAmmDollars * 100),
      charityPoolCents: Math.round(charityPoolDollars * 100),
      userCount,
      activeMarketCount: activeMarkets.length,
      pendingWithdrawalCount,
      marketExposure,
      totalExposureCents,
    };
  }),
});
