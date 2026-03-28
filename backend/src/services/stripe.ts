/**
 * Stripe service — Stripe.js PaymentIntent + fee tracking
 *
 * Handles all Stripe-related operations:
 *  - createPaymentIntent: Creates a Stripe PaymentIntent for inline Payment Element.
 *  - handlePaymentIntentSucceeded: Idempotent handler for payment_intent.succeeded webhook.
 *    Credits user balance via ledger DEPOSIT transaction, then records a STRIPE_FEE
 *    transaction to track the processing cost absorbed by the charity pool.
 *  - estimateStripeFee: Pure helper — computes the estimated Stripe fee in cents.
 *
 * Double-entry convention for STRIPE_FEE:
 *   debitAccount  = 'charity_pool'     (charity absorbs the processing cost)
 *   creditAccount = 'stripe_processor' (Stripe retains the fee)
 *
 * Reconciliation invariant:
 *   SUM(user balances) + SUM(charity_fees) + SUM(stripe_fees) + SUM(withdrawals) + house_pool
 *     = SUM(deposits)
 *
 * PRD §7.2, §7.5, Appendix A.1
 */

import Stripe from "stripe";
import { Decimal } from "decimal.js";
import { prisma } from "../db.js";
import { computeHash, getLastHash } from "./hashChain.js";

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
 * Uses automatic_payment_methods so Apple Pay, Google Pay, and cards are
 * all handled without extra configuration. The client completes payment
 * via the Stripe.js Payment Element — no redirect required.
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
 * 1. Extract userId from paymentIntent.metadata.userId.
 * 2. Idempotency check: return early if already processed.
 * 3. Credit user balance: INSERT a DEPOSIT transaction.
 * 4. Record STRIPE_FEE: INSERT a fee transaction absorbed by charity pool.
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

  // Idempotency check
  const existing = await prisma.transaction.findFirst({
    where: { stripeSessionId: paymentIntentId },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  // Credit user balance + record Stripe fee atomically
  const amountDollars = new Decimal(amountCents).div(100);
  const stripeFeeCents = estimateStripeFee(amountCents);
  const stripeFeeDollars = new Decimal(stripeFeeCents).div(100);

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

    // 1. DEPOSIT — credit user the full gross amount
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

    // 2. STRIPE_FEE — record processing cost absorbed by charity pool
    const feeAt = new Date();
    const feeHash = computeHash(
      depositHash,
      "STRIPE_FEE",
      stripeFeeDollars.toFixed(6),
      userId,
      feeAt.toISOString()
    );

    await tx.transaction.create({
      data: {
        userId,
        debitAccount: "charity_pool",
        creditAccount: "stripe_processor",
        type: "STRIPE_FEE",
        amount: stripeFeeDollars,
        prevHash: depositHash,
        txHash: feeHash,
        stripeSessionId: paymentIntentId,
        createdAt: feeAt,
      },
    });
  });
}
