"use client";

import { useState, useEffect } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { api } from "@/lib/api";
import { StripePaymentForm } from "./StripePaymentForm";

const PRESETS = [
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500 },
  { label: "$50", cents: 5000 },
];

type Step = "select-amount" | "payment" | "success";

interface DepositButtonProps {
  onSuccess?: () => void;
}

/**
 * "Add Credits" button that opens an inline deposit modal.
 *
 * Flow:
 *  1. Guest picks a preset ($10 / $25 / $50) or enters a custom amount.
 *  2. On confirmation, calls payment.createDeposit → receives clientSecret.
 *  3. Renders the Stripe Payment Element inside an <Elements> provider.
 *  4. On success: shows a confirmation state, then calls onSuccess().
 */
export function DepositButton({ onSuccess }: DepositButtonProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("select-amount");

  const [selectedCents, setSelectedCents] = useState<number | null>(1000);
  const [customDollars, setCustomDollars] = useState("");

  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveCents: number | null = customDollars
    ? Math.round(parseFloat(customDollars) * 100)
    : selectedCents;

  const isValidAmount =
    effectiveCents !== null &&
    !isNaN(effectiveCents) &&
    effectiveCents >= 500 &&
    effectiveCents <= 50000;

  useEffect(() => {
    if (!open || stripePromise) return;
    api.wallet.getPublishableKey()
      .then(({ publishableKey }) => {
        setStripePromise(loadStripe(publishableKey));
      })
      .catch(() => {});
  }, [open, stripePromise]);

  async function handleContinue() {
    if (!isValidAmount || effectiveCents === null) return;
    setLoading(true);
    setError(null);
    try {
      const { clientSecret: secret } = await api.wallet.createDeposit({
        amountCents: effectiveCents,
      });
      setClientSecret(secret);
      setStep("payment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment setup failed.");
    } finally {
      setLoading(false);
    }
  }

  function handlePaymentSuccess() {
    setStep("success");
    setTimeout(() => {
      handleClose();
      onSuccess?.();
    }, 2000);
  }

  function handleClose() {
    setOpen(false);
    setTimeout(() => {
      setStep("select-amount");
      setClientSecret(null);
      setError(null);
      setSelectedCents(1000);
      setCustomDollars("");
    }, 300);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex-1 rounded-xl bg-gold px-5 py-3 text-white font-sans font-medium
                   text-sm hover:bg-gold-600 active:scale-95 transition-all"
      >
        + Add Credits
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={step !== "payment" ? handleClose : undefined}
          />

          {/* Sheet — scrollable with max height */}
          <div className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto
                          bg-ivory rounded-t-2xl sm:rounded-2xl p-6
                          shadow-[0_-4px_40px_rgba(0,0,0,0.15)] sm:shadow-2xl">
            {/* ----------------------------------------------------------------
                Step 1: Amount selection
            ---------------------------------------------------------------- */}
            {step === "select-amount" && (
              <>
                <h2 className="font-serif text-lg font-semibold text-charcoal mb-1">
                  Add Credits
                </h2>
                <p className="text-xs text-warmGray mb-5">
                  Charged in USD via Stripe (card, bank, or Apple Pay)
                </p>

                {/* Preset amounts */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {PRESETS.map((p) => (
                    <button
                      key={p.cents}
                      onClick={() => {
                        setSelectedCents(p.cents);
                        setCustomDollars("");
                      }}
                      className={`rounded-xl py-3 text-sm font-semibold border-2 transition-all
                        ${
                          !customDollars && selectedCents === p.cents
                            ? "border-gold bg-gold-pale text-charcoal"
                            : "border-[rgba(184,134,11,0.12)] text-charcoal hover:border-gold/50"
                        }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Custom amount */}
                <div className="relative mb-4">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warmGray font-medium">
                    $
                  </span>
                  <input
                    type="number"
                    min="5"
                    max="500"
                    step="1"
                    placeholder="Custom amount"
                    value={customDollars}
                    onChange={(e) => {
                      setCustomDollars(e.target.value);
                      setSelectedCents(null);
                    }}
                    className="w-full pl-7 pr-4 py-3 border border-[rgba(184,134,11,0.12)] rounded-xl text-sm
                               focus:outline-none focus:border-gold transition text-charcoal bg-white"
                  />
                </div>

                <p className="text-xs text-warmGray mb-4">Min $5 · Max $500</p>

                {error && (
                  <p className="text-xs text-[#dc2626] mb-3 bg-red-50 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  onClick={handleContinue}
                  disabled={!isValidAmount || loading}
                  className="w-full rounded-xl bg-gold py-3.5 text-white font-sans font-medium text-sm
                             disabled:opacity-50 hover:bg-gold-600 active:scale-95 transition-all"
                >
                  {loading
                    ? "Setting up payment…"
                    : `Continue with ${
                        isValidAmount && effectiveCents
                          ? `$${(effectiveCents / 100).toFixed(2)}`
                          : ""
                      } →`}
                </button>

                <button
                  onClick={handleClose}
                  className="w-full mt-3 py-2 text-sm text-warmGray hover:text-charcoal transition"
                >
                  Cancel
                </button>
              </>
            )}

            {/* ----------------------------------------------------------------
                Step 2: Stripe Payment Element
            ---------------------------------------------------------------- */}
            {step === "payment" && clientSecret && stripePromise && (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-charcoal">
                      Payment
                    </h2>
                    <p className="text-xs text-warmGray mt-0.5">
                      {isValidAmount && effectiveCents
                        ? `$${(effectiveCents / 100).toFixed(2)}`
                        : ""}{" "}
                      · Powered by Stripe
                    </p>
                  </div>
                  <button
                    onClick={() => setStep("select-amount")}
                    className="text-xs text-warmGray hover:text-charcoal transition"
                  >
                    ← Back
                  </button>
                </div>

                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: "stripe",
                      variables: {
                        colorPrimary: "#B8860B",
                        borderRadius: "12px",
                        fontFamily: "inherit",
                      },
                    },
                  }}
                >
                  <StripePaymentForm
                    amountCents={effectiveCents ?? 0}
                    onSuccess={handlePaymentSuccess}
                    onCancel={() => setStep("select-amount")}
                  />
                </Elements>
              </>
            )}

            {/* ----------------------------------------------------------------
                Step 3: Success
            ---------------------------------------------------------------- */}
            {step === "success" && (
              <div className="text-center py-8">
                <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="font-serif text-lg font-semibold text-charcoal mb-2">
                  Payment Successful!
                </h2>
                <p className="text-sm text-warmGray">
                  Your credits will appear in your wallet shortly.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
