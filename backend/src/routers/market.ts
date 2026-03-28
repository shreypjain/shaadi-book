/**
 * Market tRPC Router — Tasks 2.1 + 2.2
 *
 * Endpoints:
 *   market.list      — public, all active markets with prices
 *   market.getById   — public, market detail + recent purchases
 *   market.buy       — authenticated, purchase outcome shares
 *   market.create    — admin only
 *   market.resolve   — admin only
 *   market.pause     — admin only
 *   market.void      — admin only
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../trpc.js";
import { buyShares, PurchaseError } from "../services/purchaseEngine.js";
import { getUserBalance } from "../services/balance.js";
import {
  createMarket,
  resolveMarket,
  pauseMarket,
  voidMarket,
  getMarketWithPrices,
  listMarkets,
  openMarket,
  type ListMarketsFilters,
} from "../services/marketService.js";
import {
  notifyNewMarket,
  notifyMarketResolved,
  scheduleMarketOpen,
} from "../services/notificationService.js";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Safe IO helper — WebSocket server may not be initialised in tests
// ---------------------------------------------------------------------------

function getIOSafe() {
  try {
    const { getIO } = require("../ws/index.js") as typeof import("../ws/index.js");
    return getIO();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const buyInput = z.object({
  marketId: z.string().uuid(),
  outcomeId: z.string().uuid(),
  dollarAmountCents: z
    .number()
    .int()
    .positive()
    .max(5000, "Maximum purchase is $50 (5000 cents) per transaction"),
});

const MarketStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "PAUSED",
  "RESOLVED",
  "VOIDED",
]);

const EventTagSchema = z.enum([
  "Sangeet",
  "Haldi",
  "Baraat",
  "Wedding Ceremony",
  "Reception",
  "After Party",
  "General",
]);

const FamilySideSchema = z.enum(["Spoorthi", "Parsh", "Both"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const marketRouter = router({
  /**
   * market.list — public
   */
  list: publicProcedure
    .input(
      z.object({
        status: MarketStatusSchema.optional(),
        eventTag: EventTagSchema.optional(),
        familySide: FamilySideSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const filters: ListMarketsFilters = {
        status: input.status,
        eventTag: input.eventTag,
        familySide: input.familySide,
      };
      const markets = await listMarkets(filters);
      return markets;
    }),

  /**
   * market.getById — public
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const market = await getMarketWithPrices(input.id);
      if (!market) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Market not found" });
      }

      const recentPurchases = await prisma.purchase.findMany({
        where: { marketId: input.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          shares: true,
          cost: true,
          avgPrice: true,
          priceBefore: true,
          priceAfter: true,
          createdAt: true,
          outcome: { select: { id: true, label: true } },
        },
      });

      return {
        ...market,
        recentPurchases: recentPurchases.map((p: typeof recentPurchases[number]) => ({
          id: p.id,
          outcomeId: p.outcome.id,
          outcomeLabel: p.outcome.label,
          shares: Number(p.shares),
          cost: Number(p.cost),
          avgPrice: Number(p.avgPrice),
          priceBefore: Number(p.priceBefore),
          priceAfter: Number(p.priceAfter),
          createdAt: p.createdAt,
        })),
      };
    }),

  /**
   * market.buy — authenticated
   */
  buy: protectedProcedure
    .input(buyInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const { marketId, outcomeId, dollarAmountCents } = input;

      let result;
      try {
        result = await buyShares(userId, marketId, outcomeId, dollarAmountCents);
      } catch (err) {
        if (err instanceof PurchaseError) {
          switch (err.code) {
            case "MARKET_NOT_FOUND":
            case "NO_OUTCOMES":
            case "OUTCOME_NOT_FOUND":
              throw new TRPCError({ code: "NOT_FOUND", message: err.message });
            case "MARKET_NOT_ACTIVE":
            case "MARKET_NOT_OPEN":
            case "INSUFFICIENT_BALANCE":
            case "CAP_EXCEEDED":
            case "INVALID_AMOUNT":
              throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
            case "RECONCILIATION_FAILED":
              console.error("[market.buy] CRITICAL reconciliation failure:", err);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Transaction integrity check failed. Please contact support.",
              });
            default:
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "An unexpected error occurred during purchase.",
              });
          }
        }
        console.error("[market.buy] Unexpected error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Purchase failed: ${err instanceof Error ? err.message : String(err)}`,
          cause: err,
        });
      }

      // Broadcast via WebSocket (fire-and-forget)
      try {
        const io = getIOSafe();
        if (io) {
          const { broadcastPriceUpdate, broadcastPurchase, broadcastBalanceUpdate } =
            await import("../ws/broadcaster.js");

          broadcastPriceUpdate(
            io,
            marketId,
            result.allNewPrices.map((p: number, i: number) => ({
              outcomeId: result.outcomeIds[i] ?? outcomeId,
              priceCents: Math.round(p * 100),
            }))
          );

          broadcastPurchase(io, marketId, {
            outcomeLabel: result.outcomeLabel,
            dollarAmount: dollarAmountCents / 100,
            priceAfterCents: result.priceAfterCents,
          });

          const newBalanceCents = await getUserBalance(userId);
          broadcastBalanceUpdate(io, userId, { balanceCents: newBalanceCents });
        }
      } catch (wsErr) {
        console.warn("[market.buy] WebSocket broadcast failed (non-fatal):", wsErr);
      }

      return result;
    }),

  /**
   * market.create — admin only
   */
  create: adminProcedure
    .input(
      z.object({
        question: z.string().min(1).max(500),
        outcomeLabels: z.array(z.string().min(1).max(100)).min(2).max(5),
        bFloorOverride: z.number().positive().optional(),
        scheduledOpenAt: z.coerce.date().optional(),
        eventTag: EventTagSchema.optional(),
        familySide: FamilySideSchema.optional(),
        customTags: z.array(z.string().min(1).max(50)).max(10).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.req.ip ?? ctx.req.socket.remoteAddress ?? "0.0.0.0";

      const marketId = await createMarket(
        ctx.userId!,
        input.question,
        input.outcomeLabels,
        {
          bFloorOverride: input.bFloorOverride,
          scheduledOpenAt: input.scheduledOpenAt,
          ipAddress,
          eventTag: input.eventTag,
          familySide: input.familySide,
          customTags: input.customTags,
        }
      );

      const market = await getMarketWithPrices(marketId);
      if (!market) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const io = getIOSafe();

      if (input.scheduledOpenAt) {
        scheduleMarketOpen(
          {
            id: marketId,
            question: input.question,
            scheduledOpenAt: input.scheduledOpenAt,
          },
          async () => {
            await openMarket(marketId);
            const opened = await getMarketWithPrices(marketId);
            if (opened) await notifyNewMarket(opened, io);
          },
          io
        );
      } else {
        await notifyNewMarket(market, io);
      }

      return market;
    }),

  /**
   * market.resolve — admin only
   */
  resolve: adminProcedure
    .input(
      z.object({
        marketId: z.string().uuid(),
        winningOutcomeId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.req.ip ?? ctx.req.socket.remoteAddress ?? "0.0.0.0";

      await resolveMarket(ctx.userId!, input.marketId, input.winningOutcomeId, {
        ipAddress,
      });

      const market = await getMarketWithPrices(input.marketId);
      if (!market) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const io = getIOSafe();
      notifyMarketResolved(
        {
          id: market.id,
          question: market.question,
          winningOutcomeId: market.winningOutcomeId,
        },
        io
      );

      return market;
    }),

  /**
   * market.pause — admin only
   */
  pause: adminProcedure
    .input(z.object({ marketId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.req.ip ?? ctx.req.socket.remoteAddress ?? "0.0.0.0";

      await pauseMarket(ctx.userId!, input.marketId, { ipAddress });

      const io = getIOSafe();
      if (io) {
        const { broadcastMarketEvent } = await import("../ws/broadcaster.js");
        broadcastMarketEvent(io, { type: "paused", marketId: input.marketId });
      }

      return { success: true, marketId: input.marketId };
    }),

  /**
   * market.void — admin only
   */
  void: adminProcedure
    .input(z.object({ marketId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const ipAddress = ctx.req.ip ?? ctx.req.socket.remoteAddress ?? "0.0.0.0";

      await voidMarket(ctx.userId!, input.marketId, { ipAddress });

      const io = getIOSafe();
      if (io) {
        const { broadcastMarketEvent } = await import("../ws/broadcaster.js");
        broadcastMarketEvent(io, { type: "voided", marketId: input.marketId });
      }

      return { success: true, marketId: input.marketId };
    }),
});
