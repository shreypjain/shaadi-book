"use client";

/**
 * SellDialog.tsx — Modal for selling shares back to the AMM.
 *
 * Features:
 *   - 30-minute cooldown guard (enforced from lastPurchaseAt)
 *   - Shares-to-sell input (capped at owned shares)
 *   - LMSR-based gross revenue preview
 *   - 10% sell fee breakdown: gross / fee / net
 *   - Confirm → loading → success states
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { costFunction } from "@/lib/lmsr";
import { cn, formatShares } from "@/lib/utils";
import { formatDollars } from "@/lib/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SELL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const SELL_FEE_RATE = 0.10; // 10%
const MAX_SHARES = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute gross sell revenue using the LMSR cost function.
 * revenue = C(q_before) - C(q_after)  where q_after[i] -= sharesToSell
 */
function computeGrossRevenue(
  q: number[],
  b: number,
  outcomeIndex: number,
  sharesToSell: number
): number {
  const qAfter = [...q];
  qAfter[outcomeIndex] = Math.max(0, (qAfter[outcomeIndex] ?? 0) - sharesToSell);
  const before = costFunction(q, b);
  const after = costFunction(qAfter, b);
  return Math.max(0, before - after);
}

/** Format mm:ss countdown string from remaining milliseconds. */
function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SellDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: { sharesSold: number; netRevenueCents: number }) => void;
  marketId: string;
  outcomeId: string;
  outcomeLabel: string;
  /** Current shares owned by the user for this outcome. */
  sharesOwned: number;
  /** ISO timestamp of user's last purchase for this outcome (cooldown check). */
  lastPurchaseAt: string | null;
  /** sharesSold vector for all outcomes (LMSR state), ordered by position. */
  outcomeSharesSold: number[];
  /** Index of this outcome in the outcomeSharesSold array. */
  outcomeIndex: number;
  /** LMSR b parameter for this market. */
  currentB: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type DialogStep = "input" | "confirming" | "success";

export function SellDialog({
  isOpen,
  onClose,
  onSuccess,
  marketId,
  outcomeId,
  outcomeLabel,
  sharesOwned,
  lastPurchaseAt,
  outcomeSharesSold,
  outcomeIndex,
  currentB,
}: SellDialogProps) {
  const [step, setStep] = useState<DialogStep>("input");
  const [sharesToSellStr, setSharesToSellStr] = useState(() =>
    sharesOwned > 0 ? sharesOwned.toFixed(2) : "0"
  );
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second to update the cooldown timer
  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  // Reset to input state whenever dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep("input");
      setError(null);
      setSharesToSellStr(sharesOwned > 0 ? sharesOwned.toFixed(2) : "0");
    }
  }, [isOpen, sharesOwned]);

  // ---------------------------------------------------------------------------
  // Cooldown
  // ---------------------------------------------------------------------------

  const cooldownRemaining = useMemo(() => {
    if (!lastPurchaseAt) return 0;
    const purchasedAt = new Date(lastPurchaseAt).getTime();
    const elapsed = now - purchasedAt;
    return Math.max(0, SELL_COOLDOWN_MS - elapsed);
  }, [lastPurchaseAt, now]);

  const isCoolingDown = cooldownRemaining > 0;

  // ---------------------------------------------------------------------------
  // Revenue preview
  // ---------------------------------------------------------------------------

  const sharesToSell = useMemo(() => {
    const val = parseFloat(sharesToSellStr);
    return isNaN(val) ? 0 : Math.max(0, Math.min(val, sharesOwned));
  }, [sharesToSellStr, sharesOwned]);

  const inputError = useMemo(() => {
    if (sharesToSell <= 0) return "Enter shares to sell";
    if (sharesToSell > sharesOwned) return `Max ${formatShares(sharesOwned)} shares`;
    return null;
  }, [sharesToSell, sharesOwned]);

  const preview = useMemo(() => {
    if (sharesToSell <= 0 || outcomeSharesSold.length === 0) return null;
    try {
      const gross = computeGrossRevenue(outcomeSharesSold, currentB, outcomeIndex, sharesToSell);
      const grossCents = Math.round(gross * 100);
      const feeCents = Math.round(grossCents * SELL_FEE_RATE);
      const netCents = grossCents - feeCents;
      return { grossCents, feeCents, netCents };
    } catch {
      return null;
    }
  }, [sharesToSell, outcomeSharesSold, currentB, outcomeIndex]);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleConfirm = useCallback(() => {
    if (inputError || isCoolingDown || step === "confirming") return;
    setError(null);
    setStep("confirming");

    api.market
      .sell({ marketId, outcomeId, shares: sharesToSell })
      .then((result) => {
        setStep("success");
        onSuccess({
          sharesSold: result.sharesSold ?? sharesToSell,
          netRevenueCents: result.netRevenueCents ?? preview?.netCents ?? 0,
        });
      })
      .catch((err: Error) => {
        setError(err.message);
        setStep("input");
      });
  }, [
    inputError,
    isCoolingDown,
    step,
    marketId,
    outcomeId,
    sharesToSell,
    onSuccess,
    preview,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isOpen) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-[rgba(184,134,11,0.12)] overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ece7]">
          <div>
            <p className="text-xs font-semibold text-warmGray uppercase tracking-wider">
              Sell Shares
            </p>
            <p className="text-base font-bold text-charcoal mt-0.5">{outcomeLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#e8e4df]/60 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-warmGray" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Confirming spinner */}
          {step === "confirming" && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-10 h-10 border-2 border-[#c8a45c]/30 border-t-[#c8a45c] rounded-full animate-spin" />
              <p className="text-sm text-warmGray font-medium">Processing sale…</p>
            </div>
          )}

          {/* Success state */}
          {step === "success" && (
            <div className="flex flex-col items-center py-6 gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
                <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-charcoal">Shares sold!</p>
                {preview && (
                  <p className="text-sm text-warmGray mt-1">
                    You received{" "}
                    <span className="font-semibold text-charcoal">
                      {formatDollars(preview.netCents)}
                    </span>{" "}
                    net
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl font-medium text-sm border border-[rgba(184,134,11,0.12)] bg-[#faf8f5] text-charcoal hover:bg-[#f0ece7] transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {/* Input state */}
          {step === "input" && (
            <>
              {/* Cooldown notice */}
              {isCoolingDown && (
                <div className="rounded-xl bg-[#f5efd9] border border-[#c8a45c]/30 px-4 py-3 flex items-center gap-3">
                  <svg className="w-4 h-4 text-[#c8a45c] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-[#8a6d30]">
                    Sell available in{" "}
                    <span className="font-bold tabular-nums">{formatCountdown(cooldownRemaining)}</span>
                  </p>
                </div>
              )}

              {/* Shares you own */}
              <div className="rounded-xl bg-[#faf8f5] border border-[rgba(184,134,11,0.12)] px-4 py-3">
                <p className="text-xs text-warmGray mb-1">Your position</p>
                <p className="text-lg font-bold text-charcoal">
                  {formatShares(sharesOwned)}{" "}
                  <span className="text-sm font-normal text-warmGray">shares owned</span>
                </p>
              </div>

              {/* Shares to sell input */}
              <div>
                <p className="text-xs font-semibold text-warmGray uppercase tracking-wider mb-2">
                  Shares to Sell
                </p>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={sharesOwned}
                    step={0.01}
                    value={sharesToSellStr}
                    onChange={(e) => setSharesToSellStr(e.target.value)}
                    className={cn(
                      "w-full px-4 py-3 rounded-xl border-2 bg-white text-xl font-bold",
                      "focus:outline-none focus:ring-0",
                      inputError && sharesToSellStr !== ""
                        ? "border-[#dc2626] text-[#dc2626]"
                        : "border-[rgba(184,134,11,0.12)] focus:border-[#1e3a5f] text-charcoal"
                    )}
                    inputMode="decimal"
                    disabled={isCoolingDown}
                  />
                  {/* Max button */}
                  <button
                    onClick={() => setSharesToSellStr(sharesOwned.toFixed(2))}
                    disabled={isCoolingDown}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#c8a45c] bg-[#f5efd9] px-2 py-1 rounded-lg hover:bg-[#f0e4c0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    MAX
                  </button>
                </div>
                {inputError && sharesToSellStr !== "" && (
                  <p className="text-xs text-[#dc2626] mt-1">{inputError}</p>
                )}
              </div>

              {/* Revenue breakdown */}
              {preview && !inputError && (
                <div
                  className="rounded-xl border border-[rgba(184,134,11,0.12)] bg-[#faf7f0] px-4 py-4 space-y-2"
                  style={{ borderLeft: "3px solid #c8a45c" }}
                >
                  <p className="text-xs font-semibold text-warmGray uppercase tracking-wider mb-3">
                    Revenue Estimate
                  </p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-warmGray">Gross revenue</span>
                    <span className="font-semibold text-charcoal tabular-nums">
                      {formatDollars(preview.grossCents)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-warmGray">Fee (10%)</span>
                    <span className="font-semibold text-[#dc2626] tabular-nums">
                      −{formatDollars(preview.feeCents)}
                    </span>
                  </div>
                  <div className="h-px bg-[#f0ece7] my-1" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-charcoal">You receive</span>
                    <span className="text-lg font-bold text-emerald-600 tabular-nums">
                      {formatDollars(preview.netCents)}
                    </span>
                  </div>
                  <p className="text-[10px] text-warmGray leading-tight pt-1">
                    LMSR estimate — actual amount may vary slightly at execution.
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-sm text-[#dc2626]">
                  {error}
                </div>
              )}

              {/* Confirm button */}
              <button
                onClick={handleConfirm}
                disabled={!!inputError || isCoolingDown || sharesToSell <= 0}
                className={cn(
                  "w-full py-4 rounded-xl font-semibold text-sm transition-all duration-200 active:scale-[0.98]",
                  !!inputError || isCoolingDown || sharesToSell <= 0
                    ? "bg-[#f0ece7] text-warmGray cursor-not-allowed"
                    : [
                        "bg-[#8a6d30] text-white",
                        "hover:bg-[#7a5f28] hover:-translate-y-0.5",
                        "shadow-sm hover:shadow-card",
                      ]
                )}
              >
                {isCoolingDown
                  ? `Sell available in ${formatCountdown(cooldownRemaining)}`
                  : `Sell ${formatShares(sharesToSell)} shares · receive ${preview ? formatDollars(preview.netCents) : "…"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
