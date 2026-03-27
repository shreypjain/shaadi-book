/**
 * Market tRPC router — Task 2.1
 *
 * Currently exposes:
 *   market.buy — authenticated procedure to purchase outcome shares
 *
 * After a successful purchase the router broadcasts three WebSocket events:
 *   1. market:{id}:prices  — new prices for all outcomes
 *   2. market:{id}:activity — anonymised purchase event
 *   3. user:{id}:balance   — updated user balance (private channel)
 *
 * WebSocket broadcasts are fire-and-forget; a failure there must never roll
 * back the committed transaction.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { buyShares, PurchaseError } from "../services/purchaseEngine.js";
import { getUserBalance } from "../services/balance.js";
import {
  broadcastPriceUpdate,
  broadcastPurchase,
  broadcastBalanceUpdate,
} from "../ws/broadcaster.js";
import { getIO } from "../ws/index.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const buyInput = z.object({
  marketId: z.string().uuid(),
  outcomeId: z.string().uuid(),
  /** Integer cents — e.g. 1000 for $10.00. */
  dollarAmountCents: z
    .number()
    .int()
    .positive()
    .max(5000, "Maximum purchase is $50 (5000 cents) per transaction"),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const marketRouter = router({
  /**
   * market.buy
   *
   * Purchase shares of a market outcome.  Protected: requires a valid JWT.
   *
   * On success:
   *   - Commits the LMSR purchase atomically.
   *   - Broadcasts live price updates and balance refresh via WebSocket.
   *   - Returns PurchaseResult to the caller.
   *
   * Throws:
   *   - UNAUTHORIZED  — no JWT
   *   - BAD_REQUEST   — INVALID_AMOUNT, MARKET_NOT_ACTIVE, OUTCOME_NOT_FOUND,
   *                     INSUFFICIENT_BALANCE, CAP_EXCEEDED
   *   - NOT_FOUND     — MARKET_NOT_FOUND, NO_OUTCOMES
   *   - INTERNAL_SERVER_ERROR — unexpected engine failures
   */
  buy: protectedProcedure
    .input(buyInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;
      const { marketId, outcomeId, dollarAmountCents } = input;

      // -----------------------------------------------------------------------
      // Execute purchase engine (atomic Postgres transaction)
      // -----------------------------------------------------------------------
      let result;
      try {
        result = await buyShares(userId, marketId, outcomeId, dollarAmountCents);
      } catch (err) {
        if (err instanceof PurchaseError) {
          // Map PurchaseError codes to tRPC error codes
          switch (err.code) {
            case "MARKET_NOT_FOUND":
            case "NO_OUTCOMES":
            case "OUTCOME_NOT_FOUND":
              throw new TRPCError({
                code: "NOT_FOUND",
                message: err.message,
              });
            case "MARKET_NOT_ACTIVE":
            case "MARKET_NOT_OPEN":
            case "INSUFFICIENT_BALANCE":
            case "CAP_EXCEEDED":
            case "INVALID_AMOUNT":
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err.message,
              });
            case "RECONCILIATION_FAILED":
              // Critical integrity failure — log prominently
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
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred during purchase.",
          cause: err,
        });
      }

      // -----------------------------------------------------------------------
      // Broadcast via WebSocket (fire-and-forget, never throws to caller)
      // -----------------------------------------------------------------------
      try {
        const io = getIO();

        // 1. Updated prices for all outcomes (parallel arrays from engine result)
        broadcastPriceUpdate(
          io,
          marketId,
          result.allNewPrices.map((p, i) => ({
            outcomeId: result.outcomeIds[i] ?? outcomeId,
            priceCents: Math.round(p * 100),
          }))
        );

        // 2. Anonymised purchase event for the activity feed
        broadcastPurchase(io, marketId, {
          outcomeLabel: result.outcomeLabel,
          dollarAmount: dollarAmountCents / 100,
          priceAfterCents: result.priceAfterCents,
        });

        // 3. Updated user balance (private channel)
        const newBalanceCents = await getUserBalance(userId);
        broadcastBalanceUpdate(io, userId, { balanceCents: newBalanceCents });
      } catch (wsErr) {
        // WebSocket failures must NOT propagate — the purchase already committed.
        console.warn("[market.buy] WebSocket broadcast failed (non-fatal):", wsErr);
      }

      return result;
    }),
});
