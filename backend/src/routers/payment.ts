/**
 * Payment tRPC Router — stripe-js-integration
 *
 * Endpoints:
 *   payment.createDeposit   — protected, creates a Stripe PaymentIntent and
 *                             returns { clientSecret } for the inline Payment Element.
 *   payment.getPublishableKey — public, returns the Stripe publishable key so
 *                              the frontend can initialise loadStripe().
 *
 * Amount presets (per PRD §7.2):
 *   $10 = 1000 cents, $25 = 2500 cents, $50 = 5000 cents, or any custom amount.
 *
 * PRD §7.2
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../trpc.js";
import { createPaymentIntent } from "../services/stripe.js";

const STRIPE_PUBLISHABLE_KEY = process.env["STRIPE_PUBLISHABLE_KEY"] ?? "";

export const paymentRouter = router({
  /**
   * payment.getPublishableKey — public (no auth required)
   *
   * Returns the Stripe publishable key so the frontend can call loadStripe().
   * Falls back to the hard-coded test key when the env var is not set.
   */
  getPublishableKey: publicProcedure.query(() => {
    const key =
      process.env["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] ?? STRIPE_PUBLISHABLE_KEY;
    return { publishableKey: key };
  }),

  /**
   * payment.createDeposit — authenticated
   *
   * Creates a Stripe PaymentIntent for the requesting user and returns the
   * client_secret needed by the Stripe.js Payment Element on the frontend.
   * Supports preset amounts ($10 / $25 / $50) and any custom amount.
   * Min: $1.00 (100 cents). Max: $1,000.00 (100,000 cents).
   *
   * Balance is only credited after the payment_intent.succeeded webhook fires
   * (see POST /api/webhooks/stripe) — never trust the client-side confirmation alone.
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

      let clientSecret: string;
      try {
        ({ clientSecret } = await createPaymentIntent(
          input.amountCents,
          userId
        ));
      } catch (err) {
        console.error("[payment.createDeposit] Failed to create PaymentIntent:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create payment session. Please try again.",
          cause: err,
        });
      }

      return { clientSecret };
    }),
});
