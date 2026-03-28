/**
 * MarketCard.tsx — Market feed card.
 *
 * Shows: question, outcome probability bars, total volume, time since opened.
 * Badges: NEW (< 5 min old, gold) and Low Activity (> 30 min no trades).
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
        "block rounded-xl border bg-white shadow-card",
        "hover:shadow-card-hover active:scale-[0.99] transition-all duration-150",
        "p-4 sm:p-5",
        isResolved && "opacity-75",
        showNew ? "border-[#c8a45c]" : "border-[#e8e4df]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="text-base font-semibold text-[#1a1a2e] leading-snug flex-1 tracking-tight">
          {market.question}
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {market.status === "ACTIVE" && !showNew && !showLowActivity && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Live
            </span>
          )}
          {showNew && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-[#f5efd9] text-[#8a6d30] text-xs font-semibold uppercase tracking-wide">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c8a45c]" />
              New
            </span>
          )}
          {showLowActivity && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-[#f5f5f5] text-[#8a8a9a] text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c8c8d0]" />
              Low activity
            </span>
          )}
          {isResolved && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-[#f5efd9] text-[#8a6d30] text-xs font-semibold">
              Resolved
            </span>
          )}
          {isPaused && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-[#f5f5f5] text-[#8a8a9a] text-xs font-semibold">
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
      <div className="flex items-center justify-between text-xs text-[#8a8a9a] mt-1">
        <span className="font-medium">{formatVolume(market.totalVolume)} volume</span>
        {openedAt && (
          <span>Opened {timeSince(openedAt)}</span>
        )}
      </div>
    </Link>
  );
}
