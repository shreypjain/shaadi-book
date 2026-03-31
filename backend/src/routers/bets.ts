/**
 * Bets tRPC Router — Task 4.2
 *
 * Endpoints:
 *   bets.myPositions — all positions for the authenticated user,
 *                       enriched with current LMSR prices and payout estimates
 *
 * References:
 *   PRD §5.1 — My Bets screen
 *   PRD §4.2 — LMSR pricing
 *   PRD §7.5 — payouts
 */

import { router, protectedProcedure } from "../trpc.js";
import { prisma } from "../db.js";
import { allPrices, defaultB } from "../services/lmsr.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toNum(v: { toNumber(): number } | number | string): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return v.toNumber();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const betsRouter = router({
  /**
   * bets.myPositions
   * Returns all positions for the authenticated user with current prices.
   * Each position includes:
   *   - market context (question, status)
   *   - outcome details (label, winner status)
   *   - holding details (shares, total cost, avg price)
   *   - live valuation (current price × shares)
   *   - potential payout (parimutuel estimate: userShares/totalWinningShares × totalPool)
   */
  myPositions: protectedProcedure.query(async ({ ctx }) => {
    const positions = await prisma.position.findMany({
      where: { userId: ctx.userId },
      include: {
        market: {
          include: {
            outcomes: { orderBy: { position: "asc" } },
            purchases: { select: { cost: true } },
          },
        },
        outcome: {
          select: {
            id: true,
            label: true,
            position: true,
            sharesSold: true,
            isWinner: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Fetch most-recent purchase timestamp per outcome for cooldown enforcement.
    // Single query: group by outcomeId, pick latest createdAt.
    const recentPurchases = await prisma.purchase.findMany({
      where: { userId: ctx.userId },
      select: { outcomeId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    // Keep only the latest per outcomeId
    const lastPurchaseByOutcome = new Map<string, Date>();
    for (const p of recentPurchases) {
      if (!lastPurchaseByOutcome.has(p.outcomeId)) {
        lastPurchaseByOutcome.set(p.outcomeId, p.createdAt);
      }
    }

    type RawPos = typeof positions[number];
    return positions.map((pos: RawPos) => {
      const market = pos.market;
      const outcome = pos.outcome;
      const shares = toNum(pos.shares as unknown as number);
      const totalCostCents = Math.round(toNum(pos.totalCost as unknown as number) * 100);

      // Total dollar volume traded in this market (= parimutuel pool size)
      const totalVolume = market.purchases.reduce(
        (sum: number, p: { cost: unknown }) => sum + toNum(p.cost as unknown as number),
        0
      );

      // Compute current LMSR prices for all outcomes in this market
      // Fixed b per market shape (admin-overridable via bFloorOverride).
      const bOverride = market.bFloorOverride != null
        ? toNum(market.bFloorOverride as unknown as number)
        : 0;
      const maxShares = Number((market as Record<string, unknown>).maxSharesPerOutcome ?? 1000);
      const b = bOverride > 0 ? bOverride : defaultB(market.outcomes.length, maxShares);
      const q = market.outcomes.map((o: { sharesSold: unknown }) => toNum(o.sharesSold as unknown as number));
      const prices = q.length >= 2 ? allPrices(q, b) : q.map(() => 0.5);

      // Find price for this specific outcome
      const outcomeIndex = market.outcomes.findIndex((o: { id: string }) => o.id === outcome.id);
      const currentPrice = prices[outcomeIndex] ?? 0.5;
      const currentPriceCents = Math.round(currentPrice * 100);
      const currentValueCents = Math.round(shares * currentPrice * 100);

      // Capped parimutuel estimated payout if this outcome wins.
      // payoutPerShare = min($1.00, totalPool / sharesSold)
      // potentialPayout = userShares × payoutPerShare
      // NOTE: this is an ESTIMATE because the pool grows as more bets come in.
      const sharesSoldOnOutcome = toNum(outcome.sharesSold as unknown as number);
      const estimatedPayoutPerShare =
        sharesSoldOnOutcome > 0 ? Math.min(1.0, totalVolume / sharesSoldOnOutcome) : 0;
      const potentialPayoutCents = Math.round(shares * estimatedPayoutPerShare * 100);

      const lastPurchaseAt = lastPurchaseByOutcome.get(outcome.id) ?? null;

      return {
        id: pos.id,
        marketId: market.id,
        marketQuestion: market.question,
        marketStatus: market.status.toLowerCase() as
          | "pending"
          | "active"
          | "paused"
          | "resolved"
          | "voided",
        outcomeId: outcome.id,
        outcomeLabel: outcome.label,
        isWinner: outcome.isWinner,
        shares,
        totalCostCents,
        avgPriceCents: shares > 0 ? Math.round(totalCostCents / shares) : 0,
        currentPriceCents,
        currentValueCents,
        potentialPayoutCents,
        /** Total shares sold on this outcome — used to compute user's % of winnings pool. */
        outcomeSharesSold: sharesSoldOnOutcome,
        /** ISO timestamp of the user's most recent purchase of this outcome (for sell cooldown). */
        lastPurchaseAt: lastPurchaseAt?.toISOString() ?? null,
      };
    });
  }),
});
