"use client";

import { useState } from "react";
import { useStripe, useElements, PaymentElement } from "@stripe/react-stripe-js";
import { INR_PER_USD } from "@/lib/api";

interface StripePaymentFormProps {
  amountCents: number;
  /** Payment currency. "inr" shows ₹ symbol and uses INR_PER_USD for amount. */
  currency?: "usd" | "inr";
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Renders the Stripe Payment Element and handles payment confirmation.
 *
 * Must be rendered inside an <Elements> provider that has been initialised
 * with a clientSecret (see DepositButton.tsx). Uses useStripe() /
 * useElements() hooks from @stripe/react-stripe-js.
 *
 * On success: calls onSuccess() so the parent can close the modal and
 * refresh the user's balance.
 */
export function StripePaymentForm({
  amountCents,
  currency = "usd",
  onSuccess,
  onCancel,
}: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      // redirect: "if_required" keeps the user on the page for card payments.
      // Apple Pay / Google Pay redirect automatically — they return to this page.
      confirmParams: {
        // Return URL for redirect-based payment methods (Apple Pay, etc.)
        return_url: typeof window !== "undefined"
          ? `${window.location.origin}/wallet?deposit=success`
          : "/wallet?deposit=success",
      },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message ?? "Payment failed. Please try again.");
      setLoading(false);
      return;
    }

    // Payment succeeded — balance will be credited via webhook.
    onSuccess();
  }

  const formattedAmount =
    currency === "inr"
      ? `₹${Math.round((amountCents / 100) * INR_PER_USD).toLocaleString("en-IN")}`
      : `$${(amountCents / 100).toFixed(2)}`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || loading}
        className="w-full rounded-xl bg-gold py-3.5 text-white font-semibold
                   disabled:opacity-50 hover:bg-gold-600 active:scale-95 transition-all"
      >
        {loading ? "Processing…" : `Pay ${formattedAmount}`}
      </button>

      <button
        type="button"
        onClick={onCancel}
        className="w-full py-2 text-sm text-warmGray hover:text-warmGray transition"
      >
        Cancel
      </button>
    </form>
  );
}
