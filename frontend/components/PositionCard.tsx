"use client";

import Link from "next/link";
import { type PositionItem, formatDollars } from "@/lib/api";

interface PositionCardProps {
  position: PositionItem;
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
    border: "border-[#e8e4df]",
    dot: "bg-[#c8a45c]",
  },
  paused: {
    badge: "PAUSED",
    badgeClass: "bg-[#f5f5f5] text-[#8a8a9a]",
    border: "border-[#e8e4df]",
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
    badgeClass: "bg-[#f5f5f5] text-[#8a8a9a]",
    border: "border-[#e8e4df]",
    dot: "bg-[#c8c8d0]",
  },
} as const;

function outcomeTextColor(position: PositionItem): string {
  if (position.marketStatus === "voided") return "text-[#8a8a9a]";
  if (position.marketStatus === "resolved") {
    if (position.isWinner === true) return "text-emerald-600 font-semibold";
    if (position.isWinner === false) return "text-[#dc2626]";
  }
  return "text-[#1e3a5f]";
}

function cardBg(position: PositionItem): string {
  if (position.marketStatus === "voided")
    return "opacity-60 bg-[#f5f5f5] border-[#e8e4df]";
  if (position.marketStatus === "resolved") {
    if (position.isWinner === true)
      return "bg-emerald-50 border-emerald-200";
    if (position.isWinner === false) return "bg-red-50 border-red-100";
  }
  return "bg-white border-[#e8e4df]";
}

/**
 * A single position card for the My Bets page.
 * Color-coded: active=blue, won=emerald, lost=muted.
 * Tapping navigates to the market detail.
 *
 * PRD §5.1 — My Bets screen
 */
export function PositionCard({ position }: PositionCardProps) {
  const cfg = STATUS_CONFIG[position.marketStatus] ?? STATUS_CONFIG.active;
  const wonLost =
    position.marketStatus === "resolved"
      ? position.isWinner === true
        ? "WON"
        : position.isWinner === false
          ? "LOST"
          : null
      : null;

  return (
    <Link href={`/markets/${position.marketId}`} className="block">
      <div
        className={`rounded-xl border p-4 transition-all active:scale-[0.98] ${cardBg(position)}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-[#1a1a2e] leading-snug flex-1">
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
            <p className="text-[#8a8a9a]">Shares</p>
            <p className="font-semibold text-[#1a1a2e]">
              {position.shares.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[#8a8a9a]">Avg price</p>
            <p className="font-semibold text-[#1a1a2e]">
              {(position.avgPriceCents / 100).toFixed(2)}¢
            </p>
          </div>
          <div>
            <p className="text-[#8a8a9a]">Total cost</p>
            <p className="font-semibold text-[#1a1a2e]">
              {formatDollars(position.totalCostCents)}
            </p>
          </div>
          <div>
            <p className="text-[#8a8a9a]">
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
                  : "text-[#1a1a2e]"
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

        {/* Potential payout for active/pending */}
        {position.marketStatus === "active" && (
          <div className="mt-3 pt-3 border-t border-[#f0ece7]">
            <p className="text-xs text-[#8a8a9a]">
              Potential payout if wins{" "}
              <span className="font-semibold text-[#1a1a2e]">
                {formatDollars(position.potentialPayoutCents)}
              </span>{" "}
              <span className="text-[#c8c8d0]">(after 20% charity)</span>
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}
