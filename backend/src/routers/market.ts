/**
 * Market tRPC Router — Task 2.2
 *
 * Endpoints:
 *   market.list      — list markets (with prices + volume), optional status filter
 *   market.getById   — get single market with LMSR prices
 *   market.create    — admin: create a market
 *   market.resolve   — admin: resolve with winning outcome + payouts
 *   market.pause     — admin: pause a market
 *   market.void      — admin: void with full refunds
 *
 * All admin mutations write an audit log (IP from the HTTP request).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc.js";
import {
  createMarket,
  resolveMarket,
  pauseMarket,
  voidMarket,
  getMarketWithPrices,
  listMarkets,
} from "../services/marketService.js";
import {
  notifyNewMarket,
  notifyMarketResolved,
  notifyMarketPaused,
  notifyMarketVoided,
} from "../services/notificationService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the caller's IP from the Express request. */
function getIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? "0.0.0.0";
}

/** Safely get the Socket.io singleton — undefined if WS not initialised. */
function safeGetIO() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getIO } = require("../ws/index.js") as {
      getIO(): import("socket.io").Server;
    };
    return getIO();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Zod input schemas
// ---------------------------------------------------------------------------

const MarketStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "PAUSED",
  "RESOLVED",
  "VOIDED",
]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const marketRouter = router({
  /**
   * market.list
   * List all markets with current LMSR prices and volume.
   * Optional status filter.
   */
  list: protectedProcedure
    .input(
      z.object({
        status: MarketStatusSchema.optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const markets = await listMarkets(input?.status);
      return markets;
    }),

  /**
   * market.getById
   * Fetch a single market with LMSR prices.
   */
  getById: protectedProcedure
    .input(z.object({ marketId: z.string().uuid() }))
    .query(async ({ input }) => {
      const market = await getMarketWithPrices(input.marketId);
      if (!market) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Market not found.",
        });
      }
      return market;
    }),

  /**
   * market.create  [admin only]
   * Create a market with 2–5 outcomes.
   * If scheduledOpenAt is in the future, market starts PENDING.
   * Otherwise, it's immediately ACTIVE.
   */
  create: adminProcedure
    .input(
      z.object({
        question: z.string().min(1).max(500),
        outcomeLabels: z
          .array(z.string().min(1).max(100))
          .min(2)
          .max(5),
        /** Admin-configurable b_floor override (default 20) */
        bFloorOverride: z.number().positive().optional(),
        /** ISO-8601 datetime string — if future, market opens at this time */
        scheduledOpenAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scheduledOpenAt = input.scheduledOpenAt
        ? new Date(input.scheduledOpenAt)
        : undefined;

      let market;
      try {
        market = await createMarket(
          ctx.userId!,
          input.question,
          input.outcomeLabels,
          input.bFloorOverride,
          scheduledOpenAt,
          getIp(ctx.req)
        );
      } catch (err: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Failed to create market.",
        });
      }

      // Notify after commit — non-blocking
      void notifyNewMarket(
        {
          marketId: market.id,
          question: market.question,
          scheduledOpenAt: market.scheduledOpenAt,
        },
        safeGetIO()
      ).catch((err: unknown) => {
        console.error("[marketRouter] notifyNewMarket error:", err);
      });

      return market;
    }),

  /**
   * market.resolve  [admin only]
   * Resolve a market, paying out all winning-outcome holders.
   */
  resolve: adminProcedure
    .input(
      z.object({
        marketId: z.string().uuid(),
        winningOutcomeId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await resolveMarket(
          ctx.userId!,
          input.marketId,
          input.winningOutcomeId,
          getIp(ctx.req)
        );
      } catch (err: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Failed to resolve market.",
        });
      }

      notifyMarketResolved(input.marketId, input.winningOutcomeId, safeGetIO());

      return result;
    }),

  /**
   * market.pause  [admin only]
   * Pause an active market — no new purchases while paused.
   */
  pause: adminProcedure
    .input(z.object({ marketId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await pauseMarket(ctx.userId!, input.marketId, getIp(ctx.req));
      } catch (err: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Failed to pause market.",
        });
      }

      notifyMarketPaused(input.marketId, safeGetIO());

      return { success: true };
    }),

  /**
   * market.void  [admin only]
   * Void a market: refund all purchases, reset LMSR state.
   */
  void: adminProcedure
    .input(z.object({ marketId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await voidMarket(ctx.userId!, input.marketId, getIp(ctx.req));
      } catch (err: unknown) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Failed to void market.",
        });
      }

      notifyMarketVoided(input.marketId, safeGetIO());

      return result;
    }),
});
