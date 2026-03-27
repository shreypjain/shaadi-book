/**
 * Payment tRPC Router — Task 3.1
 *
 * Endpoints:
 *   payment.createDeposit — protected, creates a Stripe Checkout Session and
 *                           returns the URL to redirect the guest to.
 *
 * Amount presets (per PRD §7.2):
 *   $10 = 1000 cents, $25 = 2500 cents, $50 = 5000 cents, or any custom amount.
 *
 * PRD §7.2, Appendix A.1
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { createDepositSession } from "../services/stripe.js";

export const paymentRouter = router({
  /**
   * payment.createDeposit — authenticated
   *
   * Creates a Stripe Checkout Session for the requesting user.
   * Supports preset amounts ($10 / $25 / $50) and any custom amount.
   * Min: $1.00 (100 cents). Max: $1,000.00 (100,000 cents).
   *
   * Returns { url } — the hosted Stripe Checkout URL to redirect the guest to.
   * Balance is only credited after the checkout.session.completed webhook fires
   * (see POST /api/webhooks/stripe) — never trust the client-side success redirect.
   */
  createDeposit: protectedProcedure
    .input(
      z.object({
        /**
         * Deposit amount in integer cents.
         * Presets: 1000 ($10), 2500 ($25), 5000 ($50).
         * Custom: any integer between 100 ($1) and 100000 ($1000).
         */
        amountCents: z
          .number()
          .int("Amount must be an integer number of cents")
          .min(100, "Minimum deposit is $1.00 (100 cents)")
          .max(100_000, "Maximum deposit is $1,000.00 (100,000 cents)"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx;

      let url: string;
      try {
        url = await createDepositSession(userId, input.amountCents);
      } catch (err) {
        // STRIPE_SECRET_KEY missing, Stripe API error, etc.
        console.error("[payment.createDeposit] Failed to create session:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Failed to create deposit session. Please try again.",
          cause: err,
        });
      }

      return { url };
    }),
});
