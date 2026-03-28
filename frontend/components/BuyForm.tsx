/**
 * BuyForm.tsx — Purchase form with slippage preview.
 *
 * Steps:
 *   1. Select outcome (tap to pick)
 *   2. Enter dollar amount (1–50, capped by remaining capacity)
 *   3. Preview shows shares + avg price + slippage
 *   4. Confirm button → loading → success animation
 *
 * Insufficient balance flow:
 *   - When balanceCents < dollarAmountCents an amber warning is shown
 *   - Preset deposit buttons ($10 / $25 / $50) trigger an inline Stripe payment
 *   - On deposit success the parent's onDepositSuccess() refreshes the balance
 *   - The Confirm button is disabled until balance is sufficient
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { cn, formatDollars, formatShares, outcomeColor } from "@/lib/utils";
import { computePreview } from "@/lib/lmsr";
import { api } from "@/lib/api";
import { StripePaymentForm } from "@/components/StripePaymentForm";
import type { OutcomeWithPrice } from "@/lib/api-types";

interface BuyFormProps {
  marketId: string;
  outcomes: OutcomeWithPrice[];
  currentB: number;
  remainingCapCents: number;
  /** User's current balance in cents. When provided, enables the insufficient-balance flow. */
  balanceCents?: number;
  onSuccess?: (result: { outcomeLabel: string; shares: number; costCents: number }) => void;
  /** Called after a successful in-form deposit so the parent can refetch balance. */
  onDepositSuccess?: () => void;
}

type FormStep = "select" | "amount" | "confirm" | "success";
type DepositStep = "idle" | "payment" | "success";

const PRESET_AMOUNTS = [5, 10, 25, 50] as const;

const DEPOSIT_PRESETS = [
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500 },
  { label: "$50", cents: 5000 },
] as const;

const STRIPE_APPEARANCE = {
  theme: "stripe" as const,
  variables: {
    colorPrimary: "#1e3a5f",
    borderRadius: "12px",
    fontFamily: "inherit",
  },
};

export function BuyForm({
  marketId,
  outcomes,
  currentB,
  remainingCapCents,
  balanceCents,
  onSuccess,
  onDepositSuccess,
}: BuyFormProps) {
  // -------------------------------------------------------------------------
  // Bet form state
  // -------------------------------------------------------------------------
  const [step, setStep] = useState<FormStep>("select");
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);
  const [dollarAmountStr, setDollarAmountStr] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);

  // -------------------------------------------------------------------------
  // Deposit mini-flow state
  // -------------------------------------------------------------------------
  const [depositStep, setDepositStep] = useState<DepositStep>("idle");
  const [depositAmountCents, setDepositAmountCents] = useState<number | null>(null);
  const [depositClientSecret, setDepositClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositLoadingCents, setDepositLoadingCents] = useState<number | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------
  const maxDollars = Math.min(50, remainingCapCents / 100);
  const dollarAmount = parseFloat(dollarAmountStr) || 0;
  const dollarAmountCents = Math.round(dollarAmount * 100);

  const amountError = useMemo(() => {
    if (dollarAmount <= 0) return "Enter an amount";
    if (dollarAmount < 1) return "Minimum bet is $1";
    if (dollarAmountCents > remainingCapCents)
      return `Max remaining: ${formatDollars(remainingCapCents / 100)}`;
    return null;
  }, [dollarAmount, dollarAmountCents, remainingCapCents]);

  // Balance check — only active when balanceCents is provided
  const isInsufficientBalance =
    balanceCents !== undefined &&
    dollarAmount > 0 &&
    !amountError &&
    dollarAmountCents > balanceCents;

  const shortfallCents = isInsufficientBalance
    ? dollarAmountCents - (balanceCents ?? 0)
    : 0;

  // Deposit presets filtered to those that cover at least the shortfall
  const suggestedDeposits = DEPOSIT_PRESETS.filter((p) => p.cents >= shortfallCents);

  const preview = useMemo(() => {
    if (!selectedOutcomeId || dollarAmount <= 0 || amountError) return null;
    const outcomeIndex = outcomes.findIndex((o) => o.id === selectedOutcomeId);
    if (outcomeIndex === -1) return null;
    const q = outcomes.map((o) => o.sharesSold);
    try {
      return computePreview(q, currentB, outcomeIndex, dollarAmount);
    } catch {
      return null;
    }
  }, [selectedOutcomeId, dollarAmount, outcomes, currentB, amountError]);

  const selectedOutcome = outcomes.find((o) => o.id === selectedOutcomeId);
  const selectedIndex = outcomes.findIndex((o) => o.id === selectedOutcomeId);

  // -------------------------------------------------------------------------
  // Bet handlers
  // -------------------------------------------------------------------------
  const handleConfirm = useCallback(() => {
    if (!selectedOutcomeId || amountError || isBuying || isInsufficientBalance) return;
    setError(null);
    setStep("confirm");
    setIsBuying(true);
    api.market.buy({
      marketId,
      outcomeId: selectedOutcomeId,
      dollarAmountCents,
    }).then((result: any) => {
      setStep("success");
      if (selectedOutcome) {
        onSuccess?.({
          outcomeLabel: selectedOutcome.label,
          shares: result.shares,
          costCents: dollarAmountCents,
        });
      }
    }).catch((err: Error) => {
      setError(err.message);
      setStep("amount");
    }).finally(() => {
      setIsBuying(false);
    });
  }, [selectedOutcomeId, amountError, isBuying, isInsufficientBalance, dollarAmountCents, marketId, selectedOutcome, onSuccess]);

  // -------------------------------------------------------------------------
  // Deposit handlers
  // -------------------------------------------------------------------------
  const handleAddFunds = useCallback(async (amountCents: number) => {
    setDepositError(null);
    setDepositLoading(true);
    setDepositLoadingCents(amountCents);
    try {
      // Lazy-load Stripe publishable key once
      let promise = stripePromise;
      if (!promise) {
        const { publishableKey } = await api.wallet.getPublishableKey();
        promise = loadStripe(publishableKey);
        setStripePromise(promise);
      }
      const { clientSecret } = await api.wallet.createDeposit({ amountCents });
      setDepositAmountCents(amountCents);
      setDepositClientSecret(clientSecret);
      setDepositStep("payment");
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : "Failed to set up payment. Please try again.");
    } finally {
      setDepositLoading(false);
      setDepositLoadingCents(null);
    }
  }, [stripePromise]);

  const handleDepositPaymentSuccess = useCallback(() => {
    setDepositStep("success");
    setTimeout(() => {
      setDepositStep("idle");
      setDepositClientSecret(null);
      setDepositAmountCents(null);
      onDepositSuccess?.();
    }, 2500);
  }, [onDepositSuccess]);

  const closeDeposit = useCallback(() => {
    if (depositStep === "payment") return; // Don't close mid-payment
    setDepositStep("idle");
    setDepositClientSecret(null);
    setDepositAmountCents(null);
    setDepositError(null);
  }, [depositStep]);

  const closeDepositOverlay = useCallback(() => {
    setDepositStep("idle");
    setDepositClientSecret(null);
    setDepositAmountCents(null);
    setDepositError(null);
  }, []);

  // -------------------------------------------------------------------------
  // Deposit return URL — bring user back to this market page
  // -------------------------------------------------------------------------
  const depositReturnUrl = typeof window !== "undefined"
    ? `${window.location.href.split("?")[0]}?deposit=success`
    : "/wallet?deposit=success";

  // =========================================================================
  // Render: step = "select"
  // =========================================================================

  if (step === "select") {
    return (
      <div className="animate-slide-up">
        <p className="text-sm font-medium text-[#4a4a5a] mb-3">Pick your outcome</p>
        <div className="flex flex-col gap-2">
          {outcomes.map((outcome, i) => {
            const colors = outcomeColor(i);
            return (
              <button
                key={outcome.id}
                onClick={() => {
                  setSelectedOutcomeId(outcome.id);
                  setStep("amount");
                }}
                className={cn(
                  "flex items-center justify-between w-full rounded-xl px-4 py-3",
                  "border text-left transition-all duration-150",
                  "active:scale-[0.98] hover:shadow-sm",
                  colors.light,
                  "border-[#e8e4df] hover:border-current"
                )}
              >
                <span className={cn("font-semibold text-sm", colors.text)}>{outcome.label}</span>
                <span className={cn("text-base font-bold tabular-nums", colors.text)}>
                  {Math.round(outcome.priceCents)}¢
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // =========================================================================
  // Render: step = "amount"
  // =========================================================================

  if (step === "amount") {
    const colors = selectedIndex >= 0 ? outcomeColor(selectedIndex) : outcomeColor(0);
    return (
      <>
        <div className="animate-slide-up">
          {/* Back + selected outcome */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setStep("select")}
              className="p-1.5 rounded-lg hover:bg-[#e8e4df]/60 transition-colors"
              aria-label="Back"
            >
              <svg className="w-4 h-4 text-[#4a4a5a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold",
                colors.light,
                colors.text
              )}
            >
              {selectedOutcome?.label}
            </span>
            <span className={cn("ml-auto text-base font-bold tabular-nums", colors.text)}>
              {selectedOutcome ? Math.round(selectedOutcome.priceCents) : 0}¢
            </span>
          </div>

          {/* Amount input */}
          <div className="mb-3">
            <label className="text-sm font-medium text-[#4a4a5a] block mb-1.5">
              Bet amount (max {formatDollars(maxDollars)})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a9a] font-semibold">$</span>
              <input
                type="number"
                min={1}
                max={maxDollars}
                step={1}
                value={dollarAmountStr}
                onChange={(e) => setDollarAmountStr(e.target.value)}
                className={cn(
                  "w-full pl-8 pr-4 py-3 rounded-xl border-2 bg-white text-lg font-semibold",
                  "focus:outline-none focus:ring-0",
                  amountError
                    ? "border-[#dc2626] text-[#dc2626]"
                    : "border-[#e8e4df] focus:border-[#1e3a5f] text-[#1a1a2e]"
                )}
                inputMode="decimal"
              />
            </div>
            {amountError && (
              <p className="text-xs text-[#dc2626] mt-1">{amountError}</p>
            )}
          </div>

          {/* Presets */}
          <div className="flex gap-2 mb-4">
            {PRESET_AMOUNTS.filter((a) => a <= maxDollars).map((amt) => (
              <button
                key={amt}
                onClick={() => setDollarAmountStr(String(amt))}
                className={cn(
                  "flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors",
                  dollarAmountStr === String(amt)
                    ? "border-[#1e3a5f] bg-brand-50 text-brand-700"
                    : "border-[#e8e4df] bg-white text-[#4a4a5a] hover:bg-cream-100"
                )}
              >
                ${amt}
              </button>
            ))}
          </div>

          {/* Preview — always shown when valid so user sees what they'd get */}
          {preview && !amountError && (
            <div className="rounded-xl bg-brand-50 border border-brand-100 p-3 mb-4 animate-fade-in space-y-2">
              <p className="text-sm text-[#4a4a5a] leading-relaxed">
                You&apos;ll get{" "}
                <span className="font-bold text-[#1a1a2e]">
                  {formatShares(preview.shares)} shares
                </span>{" "}
                at avg{" "}
                <span className="font-bold text-[#1a1a2e]">
                  {formatDollars(preview.avgPrice)}
                </span>
                .{" "}
                <span className="text-[#8a8a9a]">
                  Price moves{" "}
                  <span className="font-semibold text-[#4a4a5a]">
                    {Math.round(preview.priceBefore * 100)}¢
                  </span>{" "}
                  →{" "}
                  <span className="font-semibold text-[#4a4a5a]">
                    {Math.round(preview.priceAfter * 100)}¢
                  </span>
                </span>
              </p>
              <p className="text-xs bg-[#f5efd9] text-[#8a6d30] rounded-lg px-2.5 py-1.5">
                If{" "}
                <span className="font-semibold">{selectedOutcome?.label}</span>{" "}
                wins, you&apos;d get{" "}
                <span className="font-bold">{formatDollars(preview.shares)}</span>
                {" · "}Profit:{" "}
                <span className="font-bold">
                  {formatDollars(preview.shares - dollarAmount)}
                </span>
              </p>
            </div>
          )}

          {/* Insufficient balance warning + inline deposit */}
          {isInsufficientBalance && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 mb-4 animate-fade-in">
              <div className="flex items-start gap-2 mb-3">
                <svg
                  className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Insufficient balance</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    You need{" "}
                    <span className="font-bold">{formatDollars(shortfallCents / 100)}</span>{" "}
                    more to place this bet.
                  </p>
                </div>
              </div>

              {depositError && (
                <p className="text-xs text-[#dc2626] bg-red-50 rounded-lg px-2.5 py-1.5 mb-2.5 border border-red-100">
                  {depositError}
                </p>
              )}

              <p className="text-xs text-amber-700 mb-2 font-medium">Add funds:</p>
              <div className="flex gap-2">
                {suggestedDeposits.map((p) => (
                  <button
                    key={p.cents}
                    onClick={() => void handleAddFunds(p.cents)}
                    disabled={depositLoading}
                    className={cn(
                      "flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]",
                      "bg-[#c8a45c] hover:bg-[#b8944c] text-white",
                      depositLoading && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {depositLoading && depositLoadingCents === p.cents
                      ? "…"
                      : `+ ${p.label}`}
                  </button>
                ))}
                {/* If shortfall > $50, all presets filter out — offer custom exact amount */}
                {suggestedDeposits.length === 0 && (
                  <button
                    onClick={() => void handleAddFunds(Math.ceil(shortfallCents / 100) * 100)}
                    disabled={depositLoading}
                    className={cn(
                      "flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]",
                      "bg-[#c8a45c] hover:bg-[#b8944c] text-white",
                      depositLoading && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {depositLoading ? "…" : `+ Add ${formatDollars(Math.ceil(shortfallCents / 100))}`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* API / purchase error */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 mb-3 text-sm text-[#dc2626]">
              {error}
            </div>
          )}

          {/* Confirm button — disabled when balance is insufficient */}
          <button
            onClick={handleConfirm}
            disabled={!!amountError || dollarAmount <= 0 || isInsufficientBalance}
            className={cn(
              "w-full py-3.5 rounded-xl font-medium text-sm transition-all duration-150",
              "active:scale-[0.98]",
              amountError || dollarAmount <= 0 || isInsufficientBalance
                ? "bg-[#f0ece7] text-[#8a8a9a] cursor-not-allowed"
                : "bg-[#1e3a5f] text-white hover:bg-[#152f52] shadow-sm"
            )}
          >
            {isInsufficientBalance
              ? "Add funds to continue"
              : `Confirm ${formatDollars(dollarAmount)} on ${selectedOutcome?.label}`}
          </button>
        </div>

        {/* -----------------------------------------------------------------------
            Deposit overlay modal
        ----------------------------------------------------------------------- */}
        {depositStep !== "idle" && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={depositStep !== "payment" ? closeDepositOverlay : undefined}
            />

            {/* Sheet */}
            <div className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl">

              {/* Step: payment */}
              {depositStep === "payment" && depositClientSecret && stripePromise && (
                <>
                  <h2 className="text-lg font-bold text-[#1a1a2e] mb-1">Add Funds</h2>
                  <p className="text-xs text-[#8a8a9a] mb-5">
                    {depositAmountCents != null
                      ? `$${(depositAmountCents / 100).toFixed(2)}`
                      : ""}{" "}
                    · Powered by Stripe
                  </p>
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: depositClientSecret,
                      appearance: STRIPE_APPEARANCE,
                    }}
                  >
                    <StripePaymentForm
                      amountCents={depositAmountCents ?? 0}
                      onSuccess={handleDepositPaymentSuccess}
                      onCancel={closeDeposit}
                      returnUrl={depositReturnUrl}
                    />
                  </Elements>
                </>
              )}

              {/* Step: success */}
              {depositStep === "success" && (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-7 h-7 text-emerald-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <h2 className="text-lg font-bold text-[#1a1a2e] mb-2">Payment Successful!</h2>
                  <p className="text-sm text-[#8a8a9a]">
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

  // =========================================================================
  // Render: step = "confirm" (loading)
  // =========================================================================

  if (step === "confirm") {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 animate-fade-in">
        <div className="w-10 h-10 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm text-[#8a8a9a] font-medium">Placing your bet…</p>
      </div>
    );
  }

  // =========================================================================
  // Render: step = "success"
  // =========================================================================

  if (step === "success" && preview && selectedOutcome) {
    const colors = selectedIndex >= 0 ? outcomeColor(selectedIndex) : outcomeColor(0);
    return (
      <div className="flex flex-col items-center py-6 gap-4 animate-success-pop">
        {/* Checkmark */}
        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
          <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div className="text-center">
          <p className="text-base font-bold text-[#1a1a2e]">Bet placed!</p>
          <p className="text-sm text-[#4a4a5a] mt-1">
            {formatShares(preview.shares)} shares of{" "}
            <span className={cn("font-semibold", colors.text)}>{selectedOutcome.label}</span>
          </p>
          <p className="text-xs text-[#8a8a9a] mt-0.5">
            {formatDollars(dollarAmount)} · avg {formatDollars(preview.avgPrice)}/share
          </p>
        </div>

        <button
          onClick={() => {
            setStep("select");
            setSelectedOutcomeId(null);
            setDollarAmountStr("10");
          }}
          className="w-full py-3 rounded-xl font-medium text-sm border border-[#e8e4df] bg-cream-100 text-[#1a1a2e] hover:bg-cream-200 transition-colors"
        >
          Place another bet
        </button>
      </div>
    );
  }

  return null;
}
