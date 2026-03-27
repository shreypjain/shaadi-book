"use client";

import Link from "next/link";
import { type PositionItem, formatDollars } from "@/lib/api";

interface PositionCardProps {
  position: PositionItem;
}

const STATUS_CONFIG = {
  active: {
    badge: "LIVE",
    badgeClass: "bg-blue-100 text-blue-700",
    border: "border-blue-100",
    dot: "bg-blue-400",
  },
  pending: {
    badge: "UPCOMING",
    badgeClass: "bg-amber-100 text-amber-700",
    border: "border-amber-100",
    dot: "bg-amber-400",
  },
  paused: {
    badge: "PAUSED",
    badgeClass: "bg-gray-100 text-gray-600",
    border: "border-gray-100",
    dot: "bg-gray-400",
  },
  resolved: {
    badge: "RESOLVED",
    badgeClass: "bg-green-100 text-green-700",
    border: "border-green-100",
    dot: "bg-green-400",
  },
  voided: {
    badge: "VOID",
    badgeClass: "bg-gray-100 text-gray-500",
    border: "border-gray-100",
    dot: "bg-gray-300",
  },
} as const;

function outcomeColor(position: PositionItem): string {
  if (position.marketStatus === "voided") return "text-gray-400";
  if (position.marketStatus === "resolved") {
    if (position.isWinner === true) return "text-green-600 font-semibold";
    if (position.isWinner === false) return "text-red-500";
  }
  return "text-brand-700";
}

function cardClass(position: PositionItem): string {
  if (position.marketStatus === "voided")
    return "opacity-60 bg-gray-50 border-gray-100";
  if (position.marketStatus === "resolved") {
    if (position.isWinner === true)
      return "bg-green-50 border-green-200";
    if (position.isWinner === false) return "bg-red-50 border-red-100";
  }
  return "bg-white border-gray-200";
}

/**
 * A single position card for the My Bets page.
 * Color-coded: active=blue, won=green, lost=red, voided=gray.
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
        className={`rounded-2xl border-2 p-4 transition-all active:scale-[0.98] ${cardClass(position)}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-gray-800 leading-snug flex-1">
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
        <p className={`text-base mb-3 ${outcomeColor(position)}`}>
          {position.outcomeLabel}
        </p>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <p className="text-gray-400">Shares</p>
            <p className="font-semibold text-gray-800">
              {position.shares.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-gray-400">Avg price</p>
            <p className="font-semibold text-gray-800">
              {(position.avgPriceCents / 100).toFixed(2)}¢
            </p>
          </div>
          <div>
            <p className="text-gray-400">Total cost</p>
            <p className="font-semibold text-gray-800">
              {formatDollars(position.totalCostCents)}
            </p>
          </div>
          <div>
            <p className="text-gray-400">
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
                    ? "text-green-600"
                    : "text-red-500"
                  : "text-gray-800"
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
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Potential payout if wins{" "}
              <span className="font-semibold text-gray-700">
                {formatDollars(position.potentialPayoutCents)}
              </span>{" "}
              <span className="text-gray-300">(after 20% charity)</span>
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}
