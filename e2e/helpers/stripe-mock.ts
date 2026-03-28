/**
 * Stripe Webhook Simulator — e2e/helpers/stripe-mock.ts
 *
 * Builds a properly-signed `payment_intent.succeeded` webhook event and
 * POSTs it directly to the backend's /api/webhooks/stripe endpoint.
 *
 * Stripe webhook signature format (v1):
 *   Stripe-Signature: t={unix_timestamp},v1={hmac_sha256}
 *   where HMAC input is: `${timestamp}.${rawBody}`
 *   and key is STRIPE_WEBHOOK_SECRET
 *
 * Reference: https://stripe.com/docs/webhooks/signatures
 *
 * Environment:
 *   STRIPE_WEBHOOK_SECRET — must match the backend's env var
 */

import crypto from "crypto";
import type { APIRequestContext } from "@playwright/test";

const BACKEND = "http://localhost:3001";
const WEBHOOK_PATH = "/api/webhooks/stripe";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

// ---------------------------------------------------------------------------
// Signature builder
// ---------------------------------------------------------------------------

/**
 * Compute a valid Stripe-Signature header for the given raw payload.
 *
 * @param rawBody  The exact JSON string that will be sent as the request body.
 * @param secret   STRIPE_WEBHOOK_SECRET (whsec_... value).
 * @returns        The complete Stripe-Signature header value.
 */
export function buildStripeSignature(rawBody: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(signed, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

// ---------------------------------------------------------------------------
// PaymentIntent event factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal `payment_intent.succeeded` Stripe event object.
 *
 * Only the fields read by handlePaymentIntentSucceeded() are populated:
 *   - id                         → used as stripe_session_id for idempotency
 *   - amount                     → credited to user balance (in cents)
 *   - metadata.userId            → which user to credit
 *   - status                     → "succeeded"
 */
export function buildPaymentIntentEvent(opts: {
  paymentIntentId: string;
  userId: string;
  amountCents: number;
}): string {
  const { paymentIntentId, userId, amountCents } = opts;

  const event = {
    id: `evt_test_${crypto.randomBytes(8).toString("hex")}`,
    object: "event",
    api_version: "2023-10-16",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: paymentIntentId,
        object: "payment_intent",
        amount: amountCents,
        currency: "usd",
        status: "succeeded",
        metadata: {
          userId,
        },
        client_secret: `${paymentIntentId}_secret_test`,
        automatic_payment_methods: { enabled: true },
        capture_method: "automatic",
        confirmation_method: "automatic",
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        payment_method_types: ["card"],
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
  };

  return JSON.stringify(event);
}

// ---------------------------------------------------------------------------
// Main simulator
// ---------------------------------------------------------------------------

export interface SimulateDepositResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Simulate a Stripe `payment_intent.succeeded` webhook delivery.
 *
 * Posts a signed event to /api/webhooks/stripe, which triggers the backend
 * to credit the user's balance via the ledger.
 *
 * @param request        Playwright APIRequestContext
 * @param opts.userId    The user to credit
 * @param opts.amountCents  Deposit amount in cents (e.g. 1000 = $10.00)
 * @param opts.paymentIntentId  A unique PaymentIntent ID (pi_test_...)
 * @param opts.secret    Override STRIPE_WEBHOOK_SECRET (defaults to env var)
 */
export async function simulatePaymentIntentSucceeded(
  request: APIRequestContext,
  opts: {
    userId: string;
    amountCents: number;
    paymentIntentId?: string;
    secret?: string;
  }
): Promise<SimulateDepositResult> {
  const {
    userId,
    amountCents,
    paymentIntentId = `pi_test_${crypto.randomBytes(12).toString("hex")}`,
    secret = WEBHOOK_SECRET,
  } = opts;

  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. " +
        "Set it in the environment before running payment E2E tests.\n" +
        "You can find it with: stripe listen --print-secret"
    );
  }

  const rawBody = buildPaymentIntentEvent({ paymentIntentId, userId, amountCents });
  const signature = buildStripeSignature(rawBody, secret);

  const response = await request.post(`${BACKEND}${WEBHOOK_PATH}`, {
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    data: rawBody,
  });

  const body = await response.json().catch(() => ({}));

  return {
    ok: response.ok(),
    status: response.status(),
    body,
  };
}

// ---------------------------------------------------------------------------
// Helper: generate a stable test PaymentIntent ID from a tag
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic PaymentIntent ID for a given test tag.
 * Using a stable ID ensures idempotency checks work correctly when
 * re-running tests against the same DB.
 *
 * @param tag  Short unique string (e.g. "e2e-payment-flow-1")
 */
export function testPaymentIntentId(tag: string): string {
  const hash = crypto.createHash("sha256").update(tag).digest("hex").slice(0, 24);
  return `pi_test_${hash}`;
}
