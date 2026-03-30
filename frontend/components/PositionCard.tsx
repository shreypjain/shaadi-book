"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { type PositionItem, formatDollars } from "@/lib/api";
import { SellDialog } from "@/components/SellDialog";

interface PositionCardProps {
  position: PositionItem;
  /** Called after a successful sell so the parent can refetch positions. */
  onSellSuccess?: () => void;
  /**
   * LMSR state for the sell dialog preview. Passed down from the bets page
   * if available; if not provided, the sell dialog won't show a revenue preview.
   */
  marketOutcomesSold?: number[];
  outcomeIndex?: number;
  currentB?: number;
}

const STATUS_CONFIG = {
  active: {
    badge: "LIVE",
    badgeClass: "bg-brand-50 text-brand-700",
    border: "border-brand-100",
    dot: "bg-brand-400",
  },
  pending: {
    badge: "UPCOMING",
    badgeClass: "bg-[#f5efd9] text-[#8a6d30]",
    border: "border-[rgba(184,134,11,0.12)]",
    dot: "bg-[#c8a45c]",
  },
  paused: {
    badge: "PAUSED",
    badgeClass: "bg-[#f5f5f5] text-warmGray",
    border: "border-[rgba(184,134,11,0.12)]",
    dot: "bg-[#c8c8d0]",
  },
  resolved: {
    badge: "RESOLVED",
    badgeClass: "bg-emerald-50 text-emerald-700",
    border: "border-emerald-100",
    dot: "bg-emerald-400",
  },
  voided: {
    badge: "VOID",
    badgeClass: "bg-[#f5f5f5] text-warmGray",
    border: "border-[rgba(184,134,11,0.12)]",
    dot: "bg-[#c8c8d0]",
  },
} as const;

function outcomeTextColor(position: PositionItem): string {
  if (position.marketStatus === "voided") return "text-warmGray";
  if (position.marketStatus === "resolved") {
    if (position.isWinner === true) return "text-emerald-600 font-semibold";
    if (position.isWinner === false) return "text-[#dc2626]";
  }
  return "text-[#1e3a5f]";
}

function cardBg(position: PositionItem): string {
  if (position.marketStatus === "voided")
    return "opacity-60 bg-[#f5f5f5] border-[rgba(184,134,11,0.12)]";
  if (position.marketStatus === "resolved") {
    if (position.isWinner === true)
      return "bg-emerald-50 border-emerald-200";
    if (position.isWinner === false) return "bg-red-50 border-red-100";
  }
  return "bg-white border-[rgba(184,134,11,0.12)]";
}

/**
 * A single position card for the My Bets page.
 * Color-coded: active=blue, won=emerald, lost=muted.
 * Tapping the card body navigates to the market detail.
 * Active positions with shares show a Sell button (30-min cooldown enforced).
 *
 * PRD §5.1 — My Bets screen
 */
export function PositionCard({
  position,
  onSellSuccess,
  marketOutcomesSold,
  outcomeIndex = 0,
  currentB = 27,
}: PositionCardProps) {
  const cfg = STATUS_CONFIG[position.marketStatus] ?? STATUS_CONFIG.active;
  const wonLost =
    position.marketStatus === "resolved"
      ? position.isWinner === true
        ? "WON"
        : position.isWinner === false
          ? "LOST"
          : null
      : null;

  const [sellOpen, setSellOpen] = useState(false);

  const canSell =
    position.marketStatus === "active" && position.shares > 0;

  const handleSellSuccess = useCallback(
    (_result: { shares: number; revenueCents: number }) => {
      setSellOpen(false);
      onSellSuccess?.();
    },
    [onSellSuccess]
  );

  return (
    <>
      {/* Sell dialog — rendered outside the Link */}
      {canSell && (
        <SellDialog
          isOpen={sellOpen}
          onClose={() => setSellOpen(false)}
          onSuccess={handleSellSuccess}
          marketId={position.marketId}
          outcomeId={position.outcomeId}
          outcomeLabel={position.outcomeLabel}
          sharesOwned={position.shares}
          lastPurchaseAt={position.lastPurchaseAt}
          outcomeSharesSold={marketOutcomesSold ?? [position.shares]}
          outcomeIndex={outcomeIndex}
          currentB={currentB}
        />
      )}

      <div
        className={`rounded-xl border p-4 transition-all ${cardBg(position)}`}
      >
        {/* Clickable card body → market detail */}
        <Link href={`/markets/${position.marketId}`} className="block active:scale-[0.98]">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-sm font-semibold text-charcoal leading-snug flex-1 line-clamp-2">
              {position.marketQuestion}
            </p>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cfg.badgeClass}`}
              >
                {wonLost ?? cfg.badge}
              </span>
            </div>
          </div>

          {/* Outcome */}
          <p className={`text-sm font-medium mb-3 ${outcomeTextColor(position)}`}>
            {position.outcomeLabel}
          </p>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <p className="text-warmGray">Shares</p>
              <p className="font-semibold text-charcoal">
                {position.shares.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-warmGray">Avg price</p>
              <p className="font-semibold text-charcoal">
                {(position.avgPriceCents / 100).toFixed(2)}¢
              </p>
            </div>
            <div>
              <p className="text-warmGray">Total cost</p>
              <p className="font-semibold text-charcoal">
                {formatDollars(position.totalCostCents)}
              </p>
            </div>
            <div>
              <p className="text-warmGray">
                {position.marketStatus === "resolved"
                  ? position.isWinner
                    ? "Payout"
                    : "Lost"
                  : "Current value"}
              </p>
              <p
                className={`font-semibold ${
                  position.marketStatus === "resolved"
                    ? position.isWinner
                      ? "text-emerald-600"
                      : "text-[#dc2626]"
                    : "text-charcoal"
                }`}
              >
                {position.marketStatus === "resolved"
                  ? position.isWinner
                    ? formatDollars(position.potentialPayoutCents)
                    : formatDollars(0)
                  : formatDollars(position.currentValueCents)}
              </p>
            </div>
          </div>

          {/* Parimutuel estimated payout for active/pending */}
          {(position.marketStatus === "active" || position.marketStatus === "pending") &&
            position.shares > 0 && (() => {
              // Derive per-share values from existing fields
              const estPayoutPerShareCents = position.potentialPayoutCents / position.shares;
              const avgCostPerShareCents = position.avgPriceCents;
              const estPnLCents = position.potentialPayoutCents - position.totalCostCents;
              const isThinPool = estPayoutPerShareCents < avgCostPerShareCents;

              return (
                <div className="mt-3 pt-3 border-t border-[#f0ece7] space-y-2">
                  <div className="rounded-lg bg-[#f5efd9] px-2.5 py-2.5">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-2">
                      <div>
                        <p className="text-[#a08050]">Est. payout/share</p>
                        <p className="font-semibold text-[#8a6d30]">
                          {estPayoutPerShareCents.toFixed(0)}¢
                        </p>
                      </div>
                      <div>
                        <p className="text-[#a08050]">Avg cost/share</p>
                        <p className="font-semibold text-[#8a6d30]">
                          {avgCostPerShareCents.toFixed(0)}¢
                        </p>
                      </div>
                      <div>
                        <p className="text-[#a08050]">Est. total payout</p>
                        <p className="font-semibold text-[#8a6d30]">
                          {formatDollars(position.potentialPayoutCents)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#a08050]">Est. P&amp;L</p>
                        <p
                          className={`font-semibold ${
                            estPnLCents >= 0 ? "text-emerald-600" : "text-[#dc2626]"
                          }`}
                        >
                          {estPnLCents >= 0 ? "+" : ""}
                          {formatDollars(estPnLCents)}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#a08050] opacity-60">
                      Pool-based estimate — grows as more bets come in
                    </p>
                  </div>

                  {isThinPool && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 flex items-start gap-1.5">
                      <svg
                        className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-px"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <p className="text-xs text-amber-700 leading-snug">
                        The pool&apos;s running thin — rally the group chat for bigger payouts!
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}
        </Link>

        {/* Sell button — outside Link so it doesn't navigate */}
        {canSell && (
          <div className="mt-3 pt-3 border-t border-[#f0ece7]">
            <button
              onClick={() => setSellOpen(true)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold border border-[#c8a45c]/40 text-[#8a6d30] bg-[#faf7f0] hover:bg-[#f5efd9] hover:border-[#c8a45c] transition-all duration-150 active:scale-[0.98]"
            >
              Sell shares
            </button>
          </div>
        )}
      </div>
    </>
  );
}
