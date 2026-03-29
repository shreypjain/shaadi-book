/**
 * BuyForm.tsx — Purchase form with slippage preview.
 *
 * Steps:
 *   1. Select outcome (tap to pick)
 *   2. Enter dollar amount (1–200, capped by remaining capacity)
 *   3. Preview shows shares + avg price + slippage
 *   4. Confirm button → loading → success animation
 *
 * Redesigned: palace gold palette — outlined charcoal outcome cards,
 * gold price labels, gold confirm button, ivory preview card.
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { cn, formatDollars, formatShares } from "@/lib/utils";
import { computePreview } from "@/lib/lmsr";
import { api } from "@/lib/api";
import type { OutcomeWithPrice } from "@/lib/api-types";

interface BuyFormProps {
  marketId: string;
  outcomes: OutcomeWithPrice[];
  currentB: number;
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
        <p className="font-serif text-xs font-medium text-[#6B6156] uppercase tracking-[0.1em] mb-3"
          style={{ fontVariant: "small-caps" }}>
          Pick your outcome
        </p>
        <div className="flex flex-col gap-2">
          {outcomes.map((outcome) => {
            return (
              <button
                key={outcome.id}
                onClick={() => {
                  setSelectedOutcomeId(outcome.id);
                  setStep("amount");
                }}
                className={cn(
                  "flex items-center justify-between w-full rounded-xl px-4 py-3",
                  "border border-[rgba(44,44,44,0.15)] bg-white text-left transition-all duration-150",
                  "hover:border-[#B8860B]/40 hover:shadow-card active:scale-[0.98]"
                )}
              >
                <span className="font-medium text-sm text-charcoal">
                  {outcome.label}
                </span>
                <span className="text-base font-semibold tabular-nums text-[#B8860B]">
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
    return (
      <div className="flex flex-col gap-4 animate-slide-up">

        {/* 1. Outcome header card */}
        <div className="rounded-xl border border-[rgba(184,134,11,0.25)] bg-white px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setStep("select")}
            className="p-1 rounded-lg hover:bg-gold-light/60 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <svg className="w-4 h-4 text-warmGray" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-semibold text-base flex-1 leading-tight text-charcoal">
            {selectedOutcome?.label}
          </span>
          <span className="text-lg font-semibold tabular-nums flex-shrink-0 text-[#B8860B]">
            {selectedOutcome ? Math.round(selectedOutcome.priceCents) : 0}¢
          </span>
        </div>

        {/* 2. Amount section */}
        <div className="rounded-xl border border-[rgba(184,134,11,0.12)] bg-[#FAF7F2] px-4 py-4 space-y-3">
          <p className="font-serif text-xs font-medium text-warmGray tracking-[0.1em]"
            style={{ fontVariant: "small-caps" }}>
            Bet Amount <span className="font-sans normal-case font-normal">(max {formatDollars(maxDollars)})</span>
          </p>

          {/* Dollar input */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warmGray font-semibold text-lg">
              $
            </span>
            <input
              type="number"
              min={1}
              max={maxDollars}
              step={1}
              value={dollarAmountStr}
              onChange={(e) => setDollarAmountStr(e.target.value)}
              className={cn(
                "w-full pl-8 pr-4 py-3 rounded-xl border-2 bg-white text-xl font-bold",
                "focus:outline-none focus:ring-0",
                amountError
                  ? "border-[#dc2626] text-[#dc2626]"
                  : "border-[rgba(184,134,11,0.20)] focus:border-[#B8860B] text-charcoal"
              )}
              inputMode="decimal"
            />
          </div>
          {amountError && (
            <p className="text-xs text-[#dc2626] -mt-1">{amountError}</p>
          )}

          {/* Preset pills */}
          <div className="flex gap-2">
            {PRESET_AMOUNTS.filter((a) => a <= maxDollars).map((amt) => (
              <button
                key={amt}
                onClick={() => setDollarAmountStr(String(amt))}
                className={cn(
                  "flex-1 py-2 rounded-full text-sm font-semibold transition-all duration-150",
                  dollarAmountStr === String(amt)
                    ? "bg-[#B8860B] text-white shadow-sm"
                    : "bg-white border border-charcoal/20 text-charcoal hover:border-[#B8860B]/50 hover:text-[#B8860B]"
                )}
              >
                ${amt}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Preview card */}
        {preview && !amountError && (
          <div
            className="rounded-xl border border-[rgba(184,134,11,0.20)] bg-[#FAF7F0] px-4 py-4 space-y-3 animate-fade-in"
            style={{ borderLeft: '3px solid #B8860B' }}
          >
            {/* Top row: shares + avg price */}
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-charcoal">
                  {formatShares(preview.shares)}
                </span>
                <span className="text-sm font-medium text-warmGray">shares</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-warmGray">avg price </span>
                <span className="text-base font-bold text-charcoal">
                  {formatDollars(preview.avgPrice)}
                </span>
              </div>
            </div>

            {/* Middle: price movement */}
            <div className="flex items-center gap-2 text-sm">
              <svg
                className="w-3.5 h-3.5 text-[#B8860B] flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <span className="text-warmGray tabular-nums">
                {Math.round(preview.priceBefore * 100)}¢
              </span>
              <span className="text-warmGray/60">→</span>
              <span className="text-charcoal font-semibold tabular-nums">
                {Math.round(preview.priceAfter * 100)}¢
              </span>
              <span className="text-xs text-warmGray ml-auto">price impact</span>
            </div>

            {/* Bottom: gold payout banner */}
            <div className="rounded-lg bg-gold-pale px-3 py-2.5 flex items-center justify-between">
              <span className="text-sm text-warmGray">
                If{" "}
                <span className="font-semibold text-charcoal">{selectedOutcome?.label}</span>{" "}
                wins
              </span>
              <div className="text-right">
                <span className="text-sm font-bold text-[#B8860B]">
                  +{formatDollars(preview.shares - dollarAmount)}
                </span>
                <span className="text-xs text-warmGray ml-1">profit</span>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-sm text-[#dc2626]">
            {error}
          </div>
        )}

        {/* 4. Confirm button */}
        <button
          onClick={handleConfirm}
          disabled={!!amountError || dollarAmount <= 0}
          className={cn(
            "w-full py-4 rounded-xl font-semibold text-sm transition-all duration-200",
            "active:scale-[0.98]",
            amountError || dollarAmount <= 0
              ? "bg-[#EDE8E0] text-warmGray cursor-not-allowed"
              : [
                  "bg-[#B8860B] text-white",
                  "hover:bg-[#9a7009] hover:-translate-y-0.5",
                  "shadow-sm hover:shadow-card",
                ]
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
        <div className="w-10 h-10 border-2 border-gold-light border-t-gold rounded-full animate-spin" />
        <p className="text-sm text-warmGray font-medium">Placing your bet…</p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: step = "success"
  // -------------------------------------------------------------------------

  if (step === "success" && preview && selectedOutcome) {
    return (
      <div className="flex flex-col items-center py-6 gap-4 animate-success-pop">
        {/* Checkmark — gold circle */}
        <div className="w-14 h-14 rounded-full bg-gold-pale border border-[rgba(184,134,11,0.25)] flex items-center justify-center">
          <svg className="w-7 h-7 text-[#B8860B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <div className="text-center">
          <p className="font-serif text-base font-semibold text-charcoal">Bet placed!</p>
          <p className="text-sm text-warmGray mt-1">
            {formatShares(preview.shares)} shares of{" "}
            <span className="font-semibold text-charcoal">{selectedOutcome.label}</span>
          </p>
          <p className="text-xs text-warmGray mt-0.5">
            {formatDollars(dollarAmount)} · avg {formatDollars(preview.avgPrice)}/share
          </p>
        </div>

        <button
          onClick={() => {
            setStep("select");
            setSelectedOutcomeId(null);
            setDollarAmountStr("10");
          }}
          className="w-full py-3 rounded-xl font-medium text-sm border border-[rgba(184,134,11,0.25)] bg-ivory text-charcoal hover:bg-gold-light transition-colors"
        >
          Place another bet
        </button>
      </div>
    );
  }

  return null;
}
