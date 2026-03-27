/**
 * Market tRPC router — Task 2.1
 *
 * Exposes the authenticated `market.buy` procedure that calls the purchase
 * engine and then broadcasts real-time updates over WebSocket.
 *
 * Broadcasting failures are logged but never propagate to the caller —
 * the purchase itself is atomic and already committed at that point.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { buyShares } from "../services/purchaseEngine.js";
import {
  broadcastPriceUpdate,
  broadcastPurchase,
  broadcastBalanceUpdate,
} from "../ws/broadcaster.js";
import { getIO } from "../ws/index.js";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// market router
// ---------------------------------------------------------------------------

export const marketRouter = router({
  /**
   * market.buy
   *
   * Purchase shares of a single outcome in a prediction market.
   *
   * Input:
   *   marketId  — UUID of the target market.
   *   outcomeId — UUID of the chosen outcome.
   *   amountCents — Integer cents to spend (e.g. 1000 = $10.00).
   *                 Minimum $1.00; maximum $50.00 per market (enforced by engine).
   *
   * Returns the purchase receipt including shares received, effective prices,
   * and the caller's updated balance.
   */
  buy: protectedProcedure
    .input(
      z.object({
        marketId: z.string().uuid("marketId must be a UUID"),
        outcomeId: z.string().uuid("outcomeId must be a UUID"),
        amountCents: z
          .number()
          .int("amountCents must be an integer")
          .min(100, "Minimum purchase is $1.00 (100 cents)")
          .max(5000, "Maximum purchase is $50.00 (5000 cents)"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { marketId, outcomeId, amountCents } = input;
      const userId = ctx.userId;

      // Execute the atomic purchase
      const result = await buyShares(userId, marketId, outcomeId, amountCents);

      // ----------------------------------------------------------------
      // Broadcast — fire-and-forget; failures must not abort the response
      // ----------------------------------------------------------------
      try {
        const io = getIO();

        // Fetch outcome labels for the purchase event broadcast
        const outcomes = await prisma.outcome.findMany({
          where: { marketId },
          select: { id: true, label: true },
        });
        const labelMap = new Map<string, string>(
          outcomes.map((o: { id: string; label: string }) => [o.id, o.label])
        );

        // 1. Price update for all outcomes in this market
        broadcastPriceUpdate(
          io,
          marketId,
          result.newPrices.map((p) => ({
            outcomeId: p.outcomeId,
            priceCents: Math.round(p.priceDollars * 100),
          }))
        );

        // 2. Anonymised purchase event to the market activity feed
        broadcastPurchase(io, marketId, {
          outcomeLabel: labelMap.get(outcomeId) ?? outcomeId,
          dollarAmount: result.costDollars,
          priceAfterCents: Math.round(result.priceAfterDollars * 100),
        });

        // 3. Private balance update to the purchasing user
        broadcastBalanceUpdate(io, userId, {
          balanceCents: result.newBalanceCents,
        });
      } catch (broadcastErr) {
        // Broadcast is best-effort — log, never throw
        console.error("[market.buy] broadcast failed:", broadcastErr);
      }

      return {
        purchaseId: result.purchaseId,
        shares: result.shares,
        costCents: amountCents,
        bAtPurchase: result.bAtPurchase,
        priceBeforeCents: Math.round(result.priceBeforeDollars * 100),
        priceAfterCents: Math.round(result.priceAfterDollars * 100),
        newPrices: result.newPrices.map((p) => ({
          outcomeId: p.outcomeId,
          priceCents: Math.round(p.priceDollars * 100),
        })),
        newBalanceCents: result.newBalanceCents,
      };
    }),

  /**
   * market.getById
   *
   * Return market details with current outcome prices.
   * Read-only — no authentication required.
   */
  getById: protectedProcedure
    .input(z.object({ marketId: z.string().uuid() }))
    .query(async ({ input }) => {
      const market = await prisma.market.findUnique({
        where: { id: input.marketId },
        include: {
          outcomes: { orderBy: { position: "asc" } },
        },
      });

      if (!market) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Market not found." });
      }

      return market;
    }),
});
