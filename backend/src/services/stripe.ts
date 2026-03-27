/**
 * Stripe service — Task 3.1
 *
 * Handles all Stripe-related operations:
 *  - createDepositSession: Creates a Stripe Checkout Session for guest deposits.
 *  - handleCheckoutCompleted: Idempotent handler for checkout.session.completed webhook.
 *    Inserts a DEPOSIT transaction into the append-only ledger (double-entry, hash-chained).
 *
 * PRD §7.2, Appendix A.1
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
  // The Stripe constructor accepts (key, config?) — config is optional.
  // We follow the PRD Appendix A.1 pattern exactly.
  return new Stripe(key);
}

// ---------------------------------------------------------------------------
// createDepositSession
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Checkout Session for a guest deposit.
 *
 * Configuration (per PRD Appendix A.1):
 *  - mode: 'payment' (one-time charge, not subscription)
 *  - currency: 'usd'
 *  - line_items: single item named 'Shaadi Book Credits'
 *  - client_reference_id: userId — links session to our user in the webhook
 *  - success_url / cancel_url: wallet page redirects
 *
 * Apple Pay, Google Pay, and credit cards are all available automatically
 * via Stripe Checkout — no extra config needed on the server.
 *
 * @param userId     - UUID of the depositing user
 * @param amountCents - Integer amount in cents (e.g. 2500 = $25.00)
 * @returns Stripe Checkout URL to redirect the guest to
 */
export async function createDepositSession(
  userId: string,
  amountCents: number
): Promise<string> {
  const stripe = createStripeClient();
  const appUrl =
    process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    currency: "usd",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Shaadi Book Credits" },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    client_reference_id: userId,
    success_url: `${appUrl}/wallet?deposit=success`,
    cancel_url: `${appUrl}/wallet?deposit=cancelled`,
  });

  if (!session.url) {
    throw new Error("Stripe Checkout did not return a session URL");
  }

  return session.url;
}

// ---------------------------------------------------------------------------
// handleCheckoutCompleted
// ---------------------------------------------------------------------------

/**
 * Idempotent handler for the checkout.session.completed Stripe webhook event.
 *
 * Flow:
 *  1. Validate required fields are present on the session.
 *  2. Idempotency check: return early if stripeSessionId already exists in
 *     the transactions table (handles duplicate Stripe deliveries).
 *  3. Credit user balance: INSERT a DEPOSIT transaction row with proper
 *     double-entry accounts and a hash-chain entry.
 *
 * Double-entry for DEPOSIT:
 *   debitAccount  = 'stripe'        (money flows IN from Stripe)
 *   creditAccount = 'user:{userId}' (user balance increases)
 *
 * @param session - The Stripe Checkout.Session from the webhook payload
 */
export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const userId = session.client_reference_id;
  const amountCents = session.amount_total;
  const stripeSessionId = session.id;

  if (!userId) {
    throw new Error(
      `Stripe session ${stripeSessionId} is missing client_reference_id`
    );
  }
  if (amountCents == null) {
    throw new Error(
      `Stripe session ${stripeSessionId} is missing amount_total`
    );
  }

  // -------------------------------------------------------------------------
  // Idempotency check — skip if this session was already processed
  // -------------------------------------------------------------------------
  const existing = await prisma.transaction.findFirst({
    where: { stripeSessionId },
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
    // Retrieve the hash of the most recent transaction to build the chain.
    // getLastHash must be called inside the transaction for consistency.
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
        stripeSessionId,
        createdAt,
      },
    });
  });
}
