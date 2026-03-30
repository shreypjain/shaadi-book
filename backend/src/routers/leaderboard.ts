/**
 * Leaderboard tRPC Router — Task 4.2
 *
 * Endpoints (public — no auth required):
 *   leaderboard.list — users ranked by realized P&L
 *
 * Realized P&L formula (PRD §10):
 *   P&L = SUM(payouts received) − SUM(purchase costs in resolved markets)
 *
 * Only resolved-market purchase costs are counted (unrealized positions excluded).
 * Note: the 10% charity fee is collected externally (via Venmo post-wedding)
 * and is not deducted from payouts in-app.
 */

import { router, publicProcedure } from "../trpc.js";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const leaderboardRouter = router({
  /**
   * leaderboard.list
   * Returns users ranked by realized P&L, descending.
   * Includes top-50 entries with name and P&L in cents.
   */
  list: publicProcedure.query(async () => {
    // Compute realized P&L per user via two derived CTEs:
    //   1. payout_sums — total net payouts credited to each user
    //   2. cost_sums   — total purchase costs in resolved markets only
    const rows = await prisma.$queryRaw<
      Array<{ user_id: string; name: string; realized_pnl: unknown }>
    >`
      WITH payout_sums AS (
        SELECT
          t.user_id,
          COALESCE(SUM(t.amount), 0) AS total_payouts
        FROM transactions t
        WHERE t.type = 'PAYOUT'
          AND t.credit_account LIKE 'user:%'
        GROUP BY t.user_id
      ),
      cost_sums AS (
        SELECT
          p.user_id,
          COALESCE(SUM(p.cost), 0) AS total_costs
        FROM purchases p
        JOIN markets m ON m.id = p.market_id
        WHERE m.status = 'RESOLVED'
        GROUP BY p.user_id
      )
      SELECT
        u.id        AS user_id,
        u.name,
        COALESCE(ps.total_payouts, 0) - COALESCE(cs.total_costs, 0) AS realized_pnl
      FROM users u
      LEFT JOIN payout_sums ps ON ps.user_id = u.id
      LEFT JOIN cost_sums   cs ON cs.user_id = u.id
      WHERE u.phone != '+0000000000'
        AND (
          COALESCE(ps.total_payouts, 0) > 0
          OR COALESCE(cs.total_costs, 0) > 0
        )
      ORDER BY realized_pnl DESC
      LIMIT 50
    `;

    return rows.map((row: { user_id: string; name: string; realized_pnl: unknown }, idx: number) => ({
      rank: idx + 1,
      userId: row.user_id,
      name: row.name,
      // Convert dollars (DB storage) → cents (app layer)
      realizedPnlCents: Math.round(Number(row.realized_pnl) * 100),
    }));
  }),

});
