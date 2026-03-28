/**
 * Stripe service — Task stripe-js-integration
 *
 * Handles all Stripe-related operations:
 *  - createPaymentIntent: Creates a Stripe PaymentIntent for inline Payment Element.
 *    Returns { clientSecret, paymentIntentId } to the client.
 *  - handlePaymentIntentSucceeded: Idempotent handler for payment_intent.succeeded webhook.
 *    Credits user balance via ledger DEPOSIT transaction.
 *
 * PRD §7.2
 */

import Stripe from "stripe";
import { Decimal } from "decimal.js";
import { prisma } from "../db.js";
import { computeHash, getLastHash } from "./hashChain.js";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Instantiate a Stripe client using the server-side secret key.
 * Called lazily so tests can set STRIPE_SECRET_KEY before the first call.
 */
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
 * Uses automatic_payment_methods so Apple Pay, Google Pay, and cards are
 * all handled without extra configuration. The client completes payment
 * via the Stripe.js Payment Element — no redirect required.
 *
 * @param amountCents  Integer amount in cents (e.g. 2500 = $25.00)
 * @param userId       UUID of the depositing user — stored in metadata
 * @returns { clientSecret, paymentIntentId }
 */
export async function createPaymentIntent(
  amountCents: number,
  userId: string
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const stripe = createStripeClient();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata: { userId },
  });

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
 * Flow:
 *  1. Extract userId from paymentIntent.metadata.userId.
 *  2. Idempotency check: return early if this paymentIntentId was already
 *     processed (stored in stripeSessionId column of the transactions table).
 *  3. Credit user balance: INSERT a DEPOSIT transaction row with proper
 *     double-entry accounts and a hash-chain entry.
 *
 * Double-entry for DEPOSIT:
 *   debitAccount  = 'stripe'        (money flows IN from Stripe)
 *   creditAccount = 'user:{userId}' (user balance increases)
 *
 * @param paymentIntent - The Stripe.PaymentIntent from the webhook payload
 */
export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const userId = paymentIntent.metadata["userId"];
  const amountCents = paymentIntent.amount;
  const paymentIntentId = paymentIntent.id;

  if (!userId) {
    throw new Error(
      `PaymentIntent ${paymentIntentId} is missing metadata.userId`
    );
  }

  // -------------------------------------------------------------------------
  // Idempotency check — skip if this PaymentIntent was already processed.
  // We store paymentIntentId in the stripeSessionId column for consistency.
  // -------------------------------------------------------------------------
  const existing = await prisma.transaction.findFirst({
    where: { stripeSessionId: paymentIntentId },
    select: { id: true },
  });

  if (existing) {
    // Already credited — no-op to prevent double-crediting
    return;
  }

  // -------------------------------------------------------------------------
  // Credit user balance inside an atomic transaction
  // -------------------------------------------------------------------------
  const amountDollars = new Decimal(amountCents).div(100);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.$transaction as any)(async (tx: any) => {
    const prevHash = await getLastHash(tx);
    const createdAt = new Date();

    const txHash = computeHash(
      prevHash,
      "DEPOSIT",
      amountDollars.toFixed(6),
      userId,
      createdAt.toISOString()
    );

    await tx.transaction.create({
      data: {
        userId,
        debitAccount: "stripe",
        creditAccount: `user:${userId}`,
        type: "DEPOSIT",
        amount: amountDollars,
        prevHash,
        txHash,
        stripeSessionId: paymentIntentId,
        createdAt,
      },
    });
  });
}
