/**
 * Stripe service — Stripe.js PaymentIntent + fee tracking
 *
 * Handles all Stripe-related operations:
 *  - createPaymentIntent: Creates a Stripe PaymentIntent for inline Payment Element.
 *    Automatically routes Indian users (country="IN") to INR + UPI, US users to USD.
 *  - handlePaymentIntentSucceeded: Idempotent handler for payment_intent.succeeded webhook.
 *    Credits user balance via ledger DEPOSIT transaction.
 *  - estimateStripeFee: Pure helper — computes the estimated Stripe fee in cents.
 *
 * Internal ledger always stores amounts in USD cents. INR conversion happens only at
 * the Stripe payment boundary using the fixed INR_PER_USD rate.
 *
 * PRD §7.2, Appendix A.1
 */

import Stripe from "stripe";
import { Decimal } from "decimal.js";
import { prisma } from "../db.js";
import { computeHash, getLastHash } from "./hashChain.js";

// ---------------------------------------------------------------------------
// Currency conversion constants
// ---------------------------------------------------------------------------

/**
 * Fixed exchange rate used at the Stripe payment boundary.
 * Internal ledger stays in USD cents — this rate converts only when creating
 * a PaymentIntent in INR for Indian users.
 */
export const INR_PER_USD = 85;

/**
 * Convert USD cents to INR paise for Stripe PaymentIntent amounts.
 * Stripe requires integer amounts in the smallest currency unit (paise for INR).
 *
 * @param usdCents - Amount in USD cents (e.g. 1000 = $10.00)
 * @returns Amount in INR paise (e.g. 85000 = ₹850.00)
 */
export function usdCentsToInrPaise(usdCents: number): number {
  return Math.round(usdCents * INR_PER_USD);
}

// ---------------------------------------------------------------------------
// Fee helpers
// ---------------------------------------------------------------------------

/**
 * Estimate the Stripe processing fee for a given deposit amount.
 *
 * Stripe charges 2.9% + $0.30 per successful card/Apple Pay transaction.
 * The result is rounded to the nearest cent.
 *
 * @param amountCents - Deposit amount in cents (integer, e.g. 2500 = $25.00)
 * @returns Estimated fee in cents (integer)
 */
export function estimateStripeFee(amountCents: number): number {
  return Math.round(amountCents * 0.029 + 30);
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createStripeClient(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set");
  }
  return new Stripe(key);
}

// ---------------------------------------------------------------------------
// createPaymentIntent
// ---------------------------------------------------------------------------

/**
 * Create a Stripe PaymentIntent for a guest deposit.
 *
 * Routing by user country:
 *   - US (or unknown): USD, automatic_payment_methods (card, Apple Pay, Google Pay)
 *   - IN: INR, payment_method_types ["upi", "card"] — amount converted via INR_PER_USD
 *
 * The original USD cents amount is stored in metadata.originalUsdCents so that
 * handlePaymentIntentSucceeded can always credit the correct USD amount regardless
 * of which currency the PaymentIntent was denominated in.
 */
export async function createPaymentIntent(
  amountCents: number,
  userId: string
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const stripe = createStripeClient();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { country: true },
  });

  const isIndia = user?.country === "IN";

  const paymentIntent = await stripe.paymentIntents.create(
    isIndia
      ? {
          // INR PaymentIntent — amount is in paise, UPI + card enabled
          amount: usdCentsToInrPaise(amountCents),
          currency: "inr",
          payment_method_types: ["upi", "card"],
          metadata: { userId, originalUsdCents: String(amountCents) },
        }
      : {
          // USD PaymentIntent — amount is in cents, all automatic methods
          amount: amountCents,
          currency: "usd",
          automatic_payment_methods: { enabled: true },
          metadata: { userId, originalUsdCents: String(amountCents) },
        }
  );

  if (!paymentIntent.client_secret) {
    throw new Error("Stripe PaymentIntent did not return a client_secret");
  }

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };
}

// ---------------------------------------------------------------------------
// handlePaymentIntentSucceeded
// ---------------------------------------------------------------------------

/**
 * Idempotent handler for the payment_intent.succeeded Stripe webhook event.
 *
 * 1. Extract userId from paymentIntent.metadata.userId.
 * 2. Idempotency check: return early if already processed.
 * 3. Credit user balance: INSERT a DEPOSIT transaction.
 * 4. (STRIPE_FEE tracking removed — house absorbs processing cost.)
 */
export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const userId = paymentIntent.metadata["userId"];
  const paymentIntentId = paymentIntent.id;

  // Use originalUsdCents from metadata when available (handles INR PaymentIntents
  // where paymentIntent.amount is in paise, not USD cents).
  // Legacy PaymentIntents without this field are assumed to be USD cents.
  const rawOriginal = paymentIntent.metadata["originalUsdCents"];
  const amountCents = rawOriginal
    ? parseInt(rawOriginal, 10)
    : paymentIntent.amount;

  if (!userId) {
    throw new Error(
      `PaymentIntent ${paymentIntentId} is missing metadata.userId`
    );
  }

  // Idempotency check
  const existing = await prisma.transaction.findFirst({
    where: { stripeSessionId: paymentIntentId },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  // Credit user balance (house eats the Stripe fee)
  const amountDollars = new Decimal(amountCents).div(100);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.$transaction as any)(async (tx: any) => {
    const prevHash = await getLastHash(tx);
    const depositAt = new Date();

    const depositHash = computeHash(
      prevHash,
      "DEPOSIT",
      amountDollars.toFixed(6),
      userId,
      depositAt.toISOString()
    );

    // DEPOSIT — credit user the full amount (house absorbs Stripe fee)
    await tx.transaction.create({
      data: {
        userId,
        debitAccount: "stripe",
        creditAccount: `user:${userId}`,
        type: "DEPOSIT",
        amount: amountDollars,
        prevHash,
        txHash: depositHash,
        stripeSessionId: paymentIntentId,
        createdAt: depositAt,
      },
    });
  });
}
