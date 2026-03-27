/**
 * BuyForm.tsx — Purchase form with slippage preview.
 *
 * Steps:
 *   1. Select outcome (tap to pick)
 *   2. Enter dollar amount (1–50, capped by remaining capacity)
 *   3. Preview shows shares + avg price + slippage: "You'll get X shares at avg $Y. Price moves from $A → $B"
 *   4. Confirm button → loading → success animation
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { cn, formatDollars, formatShares, outcomeColor } from "@/lib/utils";
import { computePreview } from "@/lib/lmsr";
import { trpc } from "@/lib/trpc";
import type { OutcomeWithPrice } from "@/lib/api-types";

interface BuyFormProps {
  marketId: string;
  outcomes: OutcomeWithPrice[];
  /** Current LMSR b parameter */
  currentB: number;
  /** Max remaining spend in cents (5000 = $50 cap minus already spent) */
  remainingCapCents: number;
  onSuccess?: (result: { outcomeLabel: string; shares: number; costCents: number }) => void;
}

type FormStep = "select" | "amount" | "confirm" | "success";

const PRESET_AMOUNTS = [5, 10, 25, 50] as const;

export function BuyForm({
  marketId,
  outcomes,
  currentB,
  remainingCapCents,
  onSuccess,
}: BuyFormProps) {
  const [step, setStep] = useState<FormStep>("select");
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);
  const [dollarAmountStr, setDollarAmountStr] = useState("10");
  const [error, setError] = useState<string | null>(null);

  const maxDollars = Math.min(50, remainingCapCents / 100);
  const dollarAmount = parseFloat(dollarAmountStr) || 0;
  const dollarAmountCents = Math.round(dollarAmount * 100);

  // Validation
  const amountError = useMemo(() => {
    if (dollarAmount <= 0) return "Enter an amount";
    if (dollarAmount < 1) return "Minimum bet is $1";
    if (dollarAmountCents > remainingCapCents)
      return `Max remaining: ${formatDollars(remainingCapCents / 100)}`;
    return null;
  }, [dollarAmount, dollarAmountCents, remainingCapCents]);

  // Slippage preview
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

  // tRPC mutation
  const buyMutation = trpc.market.buy.useMutation({
    onSuccess: (result) => {
      setStep("success");
      if (selectedOutcome) {
        onSuccess?.({
          outcomeLabel: selectedOutcome.label,
          shares: result.shares,
          costCents: dollarAmountCents,
        });
      }
    },
    onError: (err) => {
      setError(err.message);
      setStep("amount");
    },
  });

  const handleConfirm = useCallback(() => {
    if (!selectedOutcomeId || amountError) return;
    setError(null);
    setStep("confirm");
    buyMutation.mutate({
      marketId,
      outcomeId: selectedOutcomeId,
      dollarAmountCents,
    });
  }, [selectedOutcomeId, amountError, dollarAmountCents, marketId, buyMutation]);

  // -------------------------------------------------------------------------
  // Render: step = "select"
  // -------------------------------------------------------------------------

  if (step === "select") {
    return (
      <div className="animate-slide-up">
        <p className="text-sm font-medium text-gray-600 mb-3">Pick your outcome</p>
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
                  "border-2 text-left transition-all duration-150",
                  "active:scale-[0.98]",
                  colors.light,
                  colors.border
                )}
              >
                <span className={cn("font-semibold", colors.text)}>{outcome.label}</span>
                <span className={cn("text-lg font-bold tabular-nums", colors.text)}>
                  {Math.round(outcome.priceCents)}¢
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: step = "amount"
  // -------------------------------------------------------------------------

  if (step === "amount") {
    const colors = selectedIndex >= 0 ? outcomeColor(selectedIndex) : outcomeColor(0);
    return (
      <div className="animate-slide-up">
        {/* Back + selected outcome */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setStep("select")}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Back"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          <span className={cn("ml-auto text-lg font-bold tabular-nums", colors.text)}>
            {selectedOutcome ? Math.round(selectedOutcome.priceCents) : 0}¢
          </span>
        </div>

        {/* Amount input */}
        <div className="mb-3">
          <label className="text-sm font-medium text-gray-600 block mb-1.5">
            Bet amount (max {formatDollars(maxDollars)})
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">$</span>
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
                  ? "border-red-300 focus:border-red-400 text-red-700"
                  : "border-gray-200 focus:border-brand-400 text-gray-900"
              )}
              inputMode="decimal"
            />
          </div>
          {amountError && (
            <p className="text-xs text-red-600 mt-1">{amountError}</p>
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
                  ? cn("border-brand-500 bg-brand-50 text-brand-700")
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              )}
            >
              ${amt}
            </button>
          ))}
        </div>

        {/* Preview */}
        {preview && !amountError && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-4 animate-fade-in">
            <p className="text-sm text-gray-700 leading-relaxed">
              You&apos;ll get{" "}
              <span className="font-bold text-gray-900">
                {formatShares(preview.shares)} shares
              </span>{" "}
              at avg{" "}
              <span className="font-bold text-gray-900">
                {formatDollars(preview.avgPrice)}
              </span>
              .{" "}
              <span className="text-gray-500">
                Price moves{" "}
                <span className="font-semibold text-gray-700">
                  {Math.round(preview.priceBefore * 100)}¢
                </span>{" "}
                →{" "}
                <span className="font-semibold text-gray-700">
                  {Math.round(preview.priceAfter * 100)}¢
                </span>
              </span>
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 mb-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={!!amountError || dollarAmount <= 0}
          className={cn(
            "w-full py-3.5 rounded-xl font-bold text-base transition-all duration-150",
            "active:scale-[0.98]",
            amountError || dollarAmount <= 0
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-200"
          )}
        >
          Confirm {formatDollars(dollarAmount)} on {selectedOutcome?.label}
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: step = "confirm" (loading)
  // -------------------------------------------------------------------------

  if (step === "confirm") {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 animate-fade-in">
        <div className="w-10 h-10 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-500 font-medium">Placing your bet…</p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: step = "success"
  // -------------------------------------------------------------------------

  if (step === "success" && preview && selectedOutcome) {
    const colors = selectedIndex >= 0 ? outcomeColor(selectedIndex) : outcomeColor(0);
    return (
      <div className="flex flex-col items-center py-6 gap-4 animate-success-pop">
        {/* Checkmark */}
        <div className={cn("w-16 h-16 rounded-full flex items-center justify-center", colors.light)}>
          <svg className={cn("w-8 h-8", colors.text)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div className="text-center">
          <p className="text-lg font-bold text-gray-900">Bet placed!</p>
          <p className="text-sm text-gray-500 mt-1">
            {formatShares(preview.shares)} shares of{" "}
            <span className={cn("font-semibold", colors.text)}>{selectedOutcome.label}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatDollars(dollarAmount)} · avg {formatDollars(preview.avgPrice)}/share
          </p>
        </div>

        <button
          onClick={() => {
            setStep("select");
            setSelectedOutcomeId(null);
            setDollarAmountStr("10");
          }}
          className={cn(
            "w-full py-3 rounded-xl font-semibold text-sm border-2 transition-colors",
            colors.border, colors.light, colors.text,
            "hover:opacity-90"
          )}
        >
          Place another bet
        </button>
      </div>
    );
  }

  return null;
}
