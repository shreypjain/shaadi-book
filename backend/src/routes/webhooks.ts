/**
 * Stripe Webhook Route — stripe-js-integration
 *
 * Express route (NOT tRPC) mounted at /api/webhooks/stripe.
 *
 * Security: Always verify the Stripe-Signature header before processing.
 * The raw request body (Buffer) is required for signature verification —
 * it is attached to `req.rawBody` by the express.json() verify callback
 * configured in src/index.ts.
 *
 * Handled events:
 *   payment_intent.succeeded → credit user balance via ledger DEPOSIT
 *
 * All other event types receive a 200 (acknowledged but ignored).
 *
 * PRD §7.2
 */

import { Router } from "express";
import type { Request, Response } from "express";
import Stripe from "stripe";
import {
  createStripeClient,
  handlePaymentIntentSucceeded,
} from "../services/stripe.js";

// ---------------------------------------------------------------------------
// Request type augmentation — rawBody is attached by express.json() verify
// ---------------------------------------------------------------------------

type RawBodyRequest = Request & { rawBody?: Buffer };

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const webhookRouter = Router();

/**
 * POST /api/webhooks/stripe
 *
 * 1. Extract Stripe-Signature header.
 * 2. Verify signature with STRIPE_WEBHOOK_SECRET + raw request body.
 * 3. Dispatch payment_intent.succeeded to handlePaymentIntentSucceeded.
 * 4. Return 200 { received: true } to Stripe.
 *
 * Returns 400 on signature failure (so Stripe marks the delivery as failed
 * and retries). Returns 500 only on unexpected internal errors.
 */
webhookRouter.post(
  "/stripe",
  async (req: RawBodyRequest, res: Response): Promise<void> => {
    // -----------------------------------------------------------------------
    // 1. Validate prerequisites
    // -----------------------------------------------------------------------
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

    if (!sig) {
      res.status(400).json({ error: "Missing Stripe-Signature header" });
      return;
    }

    if (!webhookSecret) {
      console.error(
        "[webhook] STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook"
      );
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      console.error("[webhook] rawBody is missing on request");
      res.status(400).json({ error: "Missing raw request body" });
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Verify Stripe signature
    // -----------------------------------------------------------------------
    const stripe = createStripeClient();
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Signature verification failed";
      console.error("[webhook] Stripe signature verification failed:", msg);
      res
        .status(400)
        .json({ error: `Webhook signature verification failed: ${msg}` });
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Handle event
    // -----------------------------------------------------------------------
    try {
      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentSucceeded(paymentIntent);
      }
      // Other event types acknowledged but not acted on.
    } catch (err) {
      console.error(
        `[webhook] Error handling Stripe event ${event.type}:`,
        err
      );
      res
        .status(500)
        .json({ error: "Internal server error processing webhook" });
      return;
    }

    // -----------------------------------------------------------------------
    // 4. Acknowledge receipt
    // -----------------------------------------------------------------------
    res.status(200).json({ received: true });
  }
);

export default webhookRouter;
