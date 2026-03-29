/**
 * MarketCard.tsx — Market feed card.
 *
 * Shows: question, outcome probability bars, total volume, time since opened.
 * Badges: NEW (< 5 min old, gold) and Low Activity (> 30 min no trades).
 * Accepts `livePrices` map for real-time socket updates.
 *
 * Redesigned: warm ivory card with subtle gold border, Cormorant question heading,
 * palace-palette status badges.
 */

"use client";

import Link from "next/link";
import { ProbabilityBar } from "./ProbabilityBar";
import { MarketTags } from "./MarketTags";
import {
  cn,
  timeSince,
  formatVolume,
  isNewMarket,
  isLowActivity,
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
        "block rounded-xl border bg-ivory-card shadow-card",
        "hover:shadow-card-hover hover:-translate-y-px active:scale-[0.99] transition-all duration-200",
        "p-4 sm:p-5",
        isResolved && "opacity-75",
        "border-[rgba(184,134,11,0.12)]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-serif text-base font-semibold text-charcoal leading-snug flex-1">
          {market.question}
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {market.status === "ACTIVE" && !showNew && !showLowActivity && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 bg-[#fdf5f6] text-[#722F37] text-xs font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#722F37]/50 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#722F37]" />
              </span>
              Live
            </span>
          )}
          {showNew && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-gold-pale text-gold text-xs font-semibold uppercase tracking-wide">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              New
            </span>
          )}
          {showLowActivity && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-[#f5f5f5] text-warmGray text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-warmGray/40" />
              Low activity
            </span>
          )}
          {isResolved && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-gold-pale text-gold text-xs font-semibold">
              Resolved
            </span>
          )}
          {isPaused && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-[#f5f5f5] text-warmGray text-xs font-semibold">
              Paused
            </span>
          )}
        </div>
      </div>

      {/* Tag pills */}
      <MarketTags market={market} className="mb-3" />

      {/* Probability bars */}
      <div className="flex flex-col gap-2 mb-3">
        {market.outcomes.map((outcome) => {
          const livePrice = livePrices?.[outcome.id];
          const displayPriceCents = livePrice !== undefined ? livePrice : outcome.priceCents;

          return (
            <ProbabilityBar
              key={outcome.id}
              label={outcome.label}
              priceCents={displayPriceCents}
              isWinner={outcome.isWinner === true}
              size="sm"
            />
          );
        })}
      </div>

      {/* Footer: volume + time */}
      <div className="flex items-center justify-between text-xs text-warmGray mt-1">
        <span className="font-medium">{formatVolume(market.totalVolume)} volume</span>
        {openedAt && (
          <span>Opened {timeSince(openedAt)}</span>
        )}
      </div>
    </Link>
  );
}
