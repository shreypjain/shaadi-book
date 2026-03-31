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

import { useState } from "react";
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
import { api } from "@/lib/api";
import type { MarketWithPrices } from "@/lib/api-types";

interface MarketCardProps {
  market: MarketWithPrices;
  /** Real-time price overrides from WebSocket: outcomeId → priceCents */
  livePrices?: Record<string, number>;
  /** Timestamp of last purchase in this market (for low-activity badge) */
  lastPurchaseAt?: Date | null;
}

export function MarketCard({ market, livePrices, lastPurchaseAt }: MarketCardProps) {
  const [isWatching, setIsWatching] = useState(!!market.isWatching);
  const [watchLoading, setWatchLoading] = useState(false);

  async function handleWatchToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (watchLoading) return;
    setWatchLoading(true);
    try {
      if (isWatching) {
        await api.market.unwatch({ marketId: market.id });
        setIsWatching(false);
      } else {
        await api.market.watch({ marketId: market.id });
        setIsWatching(true);
      }
    } catch {
      // Non-fatal — may be unauthenticated
    } finally {
      setWatchLoading(false);
    }
  }
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
        "block rounded-2xl border bg-white/80 backdrop-blur-sm",
        "shadow-[0_2px_16px_rgba(139,109,71,0.06)]",
        "hover:shadow-[0_4px_24px_rgba(139,109,71,0.10)] hover:-translate-y-0.5",
        "active:scale-[0.99] transition-all duration-200",
        "px-6 py-5",
        isResolved && "opacity-75",
        "border-[rgba(184,134,11,0.08)]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-serif text-xl font-semibold text-charcoal leading-snug flex-1 line-clamp-2">
          {market.question}
        </h3>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {market.status === "ACTIVE" && !showNew && !showLowActivity && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 bg-[#FAF7F2] border border-[#D4C5A9]/30 text-[#8B7355] text-[10px] font-sans font-medium">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B8860B]/50 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#B8860B]" />
              </span>
              Live
            </span>
          )}
          {showNew && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-[#FAF7F2] border border-[#D4C5A9]/30 text-[#B8860B] text-[10px] font-sans font-medium uppercase tracking-wide">
              New
            </span>
          )}
          {showLowActivity && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-[#FAF7F2] border border-[#D4C5A9]/30 text-[#8B7355] text-[10px] font-sans font-medium">
              Low activity
            </span>
          )}
          {isResolved && (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 bg-[#FAF7F2] border border-[#D4C5A9]/30 text-[#8B7355] text-[10px] font-sans font-medium">
              Resolved
            </span>
          )}
          {isPaused && (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 bg-[#FAF7F2] border border-[#D4C5A9]/30 text-[#8B7355] text-[10px] font-sans font-medium">
              Paused
            </span>
          )}
          {/* Watch toggle */}
          <button
            onClick={(e) => void handleWatchToggle(e)}
            disabled={watchLoading}
            aria-label={isWatching ? "Unwatch market" : "Watch market"}
            title={isWatching ? "Unwatch" : "Watch"}
            className="p-0.5 rounded transition-opacity disabled:opacity-40"
          >
            {isWatching ? (
              <svg className="w-4 h-4 text-[#B8860B]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[#B8860B]/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Tag pills */}
      <MarketTags market={market} className="mb-4" />

      {/* Probability bars */}
      <div className="flex flex-col gap-3 mb-4">
        {market.outcomes.map((outcome) => {
          const livePrice = livePrices?.[outcome.id];
          const displayPriceCents = livePrice !== undefined ? livePrice : outcome.priceCents;
          const sharesRemaining = outcome.sharesRemaining ?? Math.max(0, (outcome.maxShares ?? 100) - outcome.sharesSold);
          const maxShares = outcome.maxShares ?? 100;

          return (
            <div key={outcome.id} className="space-y-0.5">
              <ProbabilityBar
                label={outcome.label}
                priceCents={displayPriceCents}
                isWinner={outcome.isWinner === true}
                size="sm"
              />
              <p className="text-[10px] text-[#8B7355]/60 pl-0.5 tabular-nums">
                {sharesRemaining.toFixed(0)}/{maxShares} shares remaining
              </p>
            </div>
          );
        })}
      </div>

      {/* Footer: volume + bettor count + time — receded supporting info */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-3">
          <span className="font-sans text-xs font-normal text-[#8B7355]/60">{formatVolume(market.totalVolume)} volume</span>
          <span className="font-sans text-xs font-normal text-[#8B7355]/60">
            {market.uniqueBettorCount ?? 0} bettor{(market.uniqueBettorCount ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>
        {openedAt && (
          <span className="font-sans text-xs font-normal text-[#8B7355]/60">Opened {timeSince(openedAt)}</span>
        )}
      </div>
    </Link>
  );
}
