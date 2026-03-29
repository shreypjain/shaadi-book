/**
 * BuyForm.tsx — Purchase form with slippage preview.
 *
 * Steps:
 *   1. Select outcome (tap to pick)
 *   2. Enter dollar amount (1–50, capped by remaining capacity)
 *   3. Preview shows shares + avg price + slippage
 *   4. Confirm button → loading → success animation
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { cn, formatDollars, formatShares, outcomeColor } from "@/lib/utils";
import { computePreview } from "@/lib/lmsr";
import { api } from "@/lib/api";
import type { OutcomeWithPrice } from "@/lib/api-types";

interface BuyFormProps {
  marketId: string;
  outcomes: OutcomeWithPrice[];
  currentB: number;
  /** Current total parimutuel pool in dollars (= sum of all purchase costs). */
  totalPool: number;
  remainingCapCents: number;
  onSuccess?: (result: { outcomeLabel: string; shares: number; costCents: number }) => void;
}

type FormStep = "select" | "amount" | "confirm" | "success";

const PRESET_AMOUNTS = [10, 25, 50, 100, 200] as const;

export function BuyForm({
  marketId,
  outcomes,
  currentB,
  totalPool,
  remainingCapCents,
  onSuccess,
}: BuyFormProps) {
  const [step, setStep] = useState<FormStep>("select");
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(null);
  const [dollarAmountStr, setDollarAmountStr] = useState("10");
  const [error, setError] = useState<string | null>(null);

  const maxDollars = Math.min(200, remainingCapCents / 100);
  const dollarAmount = parseFloat(dollarAmountStr) || 0;
  const dollarAmountCents = Math.round(dollarAmount * 100);

  const amountError = useMemo(() => {
    if (dollarAmount <= 0) return "Enter an amount";
    if (dollarAmount < 1) return "Minimum bet is $1";
    if (dollarAmountCents > remainingCapCents)
      return `Max remaining: ${formatDollars(remainingCapCents / 100)}`;
    return null;
  }, [dollarAmount, dollarAmountCents, remainingCapCents]);

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

  const [isBuying, setIsBuying] = useState(false);

  const handleConfirm = useCallback(() => {
    if (!selectedOutcomeId || amountError || isBuying) return;
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
  }, [selectedOutcomeId, amountError, isBuying, dollarAmountCents, marketId, selectedOutcome, onSuccess]);

  // -------------------------------------------------------------------------
  // Render: step = "select"
  // -------------------------------------------------------------------------

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

        {/* Preview */}
        {preview && !amountError && selectedOutcome && (
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
            {(() => {
              // Parimutuel estimated payout:
              // After this bet, pool = totalPool + dollarAmount
              // After this bet, winning shares on this outcome = sharesSold + preview.shares
              // User's share of pool = preview.shares / (sharesSold + preview.shares)
              const newPool = totalPool + dollarAmount;
              const newSharesOnOutcome = selectedOutcome.sharesSold + preview.shares;
              const estimatedPayout =
                newSharesOnOutcome > 0
                  ? (preview.shares / newSharesOnOutcome) * newPool
                  : 0;
              const estimatedProfit = estimatedPayout - dollarAmount;
              return (
                <p className="text-xs bg-[#f5efd9] text-[#8a6d30] rounded-lg px-2.5 py-1.5">
                  If{" "}
                  <span className="font-semibold">{selectedOutcome.label}</span>{" "}
                  wins, est. payout:{" "}
                  <span className="font-bold">{formatDollars(estimatedPayout)}</span>
                  {" · "}Profit:{" "}
                  <span className="font-bold">
                    {formatDollars(estimatedProfit)}
                  </span>
                  {" · "}
                  <span className="opacity-70">pool: {formatDollars(newPool)}</span>
                </p>
              );
            })()}
            <p className="text-[10px] text-[#8a8a9a] leading-tight">
              Payout depends on final pool size — estimate grows as more bets come in.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2 mb-3 text-sm text-[#dc2626]">
            {error}
          </div>
        )}

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={!!amountError || dollarAmount <= 0}
          className={cn(
            "w-full py-3.5 rounded-xl font-medium text-sm transition-all duration-150",
            "active:scale-[0.98]",
            amountError || dollarAmount <= 0
              ? "bg-[#f0ece7] text-[#8a8a9a] cursor-not-allowed"
              : "bg-[#1e3a5f] text-white hover:bg-[#152f52] shadow-sm"
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
        <div className="w-10 h-10 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm text-[#8a8a9a] font-medium">Placing your bet…</p>
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
