/**
 * MarketCard.tsx — Market feed card.
 *
 * Shows: question, outcome probability bars, total volume, time since opened.
 * Badges: NEW (pulsing, < 5 min old) and Low Activity (> 30 min no trades).
 * Accepts `livePrices` map for real-time socket updates.
 */

"use client";

import Link from "next/link";
import { ProbabilityBar } from "./ProbabilityBar";
import {
  cn,
  timeSince,
  formatVolume,
  isNewMarket,
  isLowActivity,
  outcomeColor,
} from "@/lib/utils";
import type { MarketWithPrices } from "@/lib/api-types";

interface MarketCardProps {
  market: MarketWithPrices;
  /** Real-time price overrides from WebSocket: outcomeId → priceCents */
  livePrices?: Record<string, number>;
  /** Timestamp of last purchase in this market (for low-activity badge) */
  lastPurchaseAt?: Date | null;
}

export function MarketCard({ market, livePrices, lastPurchaseAt }: MarketCardProps) {
  // tRPC serializes dates as strings; convert to Date for badge logic
  const openedAt = market.openedAt ? new Date(market.openedAt) : null;
  const showNew = isNewMarket(openedAt);
  const showLowActivity =
    !showNew && market.status === "ACTIVE" && isLowActivity(openedAt, lastPurchaseAt ?? null);

  const isResolved = market.status === "RESOLVED";
  const isPaused = market.status === "PAUSED";

  return (
    <Link
      href={`/markets/${market.id}`}
      className={cn(
        "block rounded-2xl border bg-white shadow-sm",
        "hover:shadow-md active:scale-[0.99] transition-all duration-150",
        "p-4 sm:p-5",
        isResolved && "opacity-80",
        showNew && "border-rose-300 shadow-rose-100"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-base font-semibold text-gray-900 leading-snug flex-1">
          {market.question}
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {showNew && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                "bg-rose-100 text-rose-700 text-xs font-bold uppercase tracking-wide",
                "animate-pulse_soft"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
              New
            </span>
          )}
          {showLowActivity && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
              Low activity
            </span>
          )}
          {isResolved && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold">
              Resolved
            </span>
          )}
          {isPaused && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-semibold">
              Paused
            </span>
          )}
        </div>
      </div>

      {/* Probability bars */}
      <div className="flex flex-col gap-2 mb-3">
        {market.outcomes.map((outcome, i) => {
          const livePrice = livePrices?.[outcome.id];
          const displayPriceCents = livePrice !== undefined ? livePrice : outcome.priceCents;
          const colors = outcomeColor(i);

          return (
            <ProbabilityBar
              key={outcome.id}
              label={outcome.label}
              priceCents={displayPriceCents}
              barColor={colors.bar}
              textColor={colors.text}
              trackColor={colors.light}
              isWinner={outcome.isWinner === true}
              size="sm"
            />
          );
        })}
      </div>

      {/* Footer: volume + time */}
      <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
        <span className="font-medium">{formatVolume(market.totalVolume)} volume</span>
        {openedAt && (
          <span>Opened {timeSince(openedAt)}</span>
        )}
      </div>
    </Link>
  );
}
