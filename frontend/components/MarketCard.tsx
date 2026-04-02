/**
 * MarketCard.tsx — Compact market feed card.
 *
 * Redesigned for 10+ markets: compact layout with leading outcome price
 * prominent, thin probability bar, change indicator, and social proof.
 *
 * Design inspired by Polymarket/Robinhood: scannable rows that communicate
 * the market state at a glance without needing to tap in.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { MarketTags } from "./MarketTags";
import {
  cn,
  timeSince,
  formatVolume,
  isNewMarket,
} from "@/lib/utils";
import { api } from "@/lib/api";
import type { MarketWithPrices } from "@/lib/api-types";

interface MarketCardProps {
  market: MarketWithPrices;
  /** Real-time price overrides from WebSocket: outcomeId → priceCents */
  livePrices?: Record<string, number>;
  /** Timestamp of last purchase in this market (for low-activity badge) */
  lastPurchaseAt?: Date | null;
  /** Render as the featured hero card at the top of the feed */
  hero?: boolean;
}

export function MarketCard({ market, livePrices, hero = false }: MarketCardProps) {
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
  const isResolved = market.status === "RESOLVED";
  const isPaused = market.status === "PAUSED";

  // Find the leading outcome (highest price) for prominent display
  const outcomesWithPrices = market.outcomes.map((o) => ({
    ...o,
    displayPrice: livePrices?.[o.id] ?? o.priceCents,
  }));
  const sorted = [...outcomesWithPrices].sort((a, b) => b.displayPrice - a.displayPrice);
  const leader = sorted[0];
  const trailer = sorted[1];

  // For binary markets, show both sides compactly
  const isBinary = market.outcomes.length === 2;

  // Status badge
  const statusBadge = isResolved
    ? { label: "Resolved", style: "bg-[#F0EDE8] text-[#8B7355]" }
    : isPaused
    ? { label: "Paused", style: "bg-[#F0EDE8] text-[#8B7355]" }
    : showNew
    ? { label: "New", style: "bg-[#FFF8E7] text-[#B8860B] border-[#B8860B]/20" }
    : null;

  // ---- HERO CARD ----
  if (hero && leader) {
    return (
      <Link
        href={`/markets/${market.id}`}
        className={cn(
          "block rounded-2xl border bg-white",
          "shadow-[0_4px_24px_rgba(139,109,71,0.08)]",
          "hover:shadow-[0_6px_32px_rgba(139,109,71,0.12)] hover:-translate-y-0.5",
          "active:scale-[0.99] transition-all duration-200",
          "p-5 border-[#B8860B]/15"
        )}
      >
        {/* Trending badge */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B8860B]/50 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#B8860B]" />
          </span>
          <span className="text-[10px] font-semibold tracking-[0.15em] uppercase text-[#B8860B]">
            Trending
          </span>
        </div>

        <h3 className="font-serif text-lg font-semibold text-charcoal leading-snug mb-3 line-clamp-2">
          {market.question}
        </h3>

        <MarketTags market={market} className="mb-3" />

        {/* All outcomes with full probability bars */}
        <div className="space-y-2.5 mb-3">
          {outcomesWithPrices.map((o) => (
            <div key={o.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-charcoal flex items-center gap-1">
                  {o.isWinner && <span className="text-[#B8860B] text-xs">&#10003;</span>}
                  {o.label}
                </span>
                <span className="text-sm font-bold tabular-nums text-[#B8860B]">
                  {Math.round(o.displayPrice)}&#162;
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#EDE8E0] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.max(2, Math.min(98, o.displayPrice))}%`,
                    background: "linear-gradient(90deg, #B8860B 0%, #D4A847 100%)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer stats */}
        <div className="flex items-center gap-3 text-xs text-[#8B7355]/70">
          <span className="font-medium">{formatVolume(market.totalVolume)} vol</span>
          <span className="w-px h-3 bg-[#8B7355]/20" />
          <span>{market.uniqueBettorCount ?? 0} guest{(market.uniqueBettorCount ?? 0) !== 1 ? "s" : ""}</span>
          {openedAt && (
            <>
              <span className="w-px h-3 bg-[#8B7355]/20" />
              <span>{timeSince(openedAt)}</span>
            </>
          )}
        </div>
      </Link>
    );
  }

  // ---- COMPACT CARD ----
  if (!leader) return null;

  return (
    <Link
      href={`/markets/${market.id}`}
      className={cn(
        "block rounded-xl border bg-white/90",
        "shadow-[0_1px_8px_rgba(139,109,71,0.04)]",
        "hover:shadow-[0_2px_16px_rgba(139,109,71,0.08)] hover:-translate-y-0.5",
        "active:scale-[0.995] transition-all duration-200",
        "px-4 py-3",
        isResolved && "opacity-60",
        "border-[rgba(184,134,11,0.08)]"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Left: question + bar + meta */}
        <div className="flex-1 min-w-0">
          {/* Question */}
          <div className="flex items-start gap-2 mb-1.5">
            <h3 className="font-serif text-[15px] font-semibold text-charcoal leading-snug flex-1 line-clamp-2">
              {market.question}
            </h3>
            {statusBadge && (
              <span className={cn(
                "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
                statusBadge.style
              )}>
                {statusBadge.label}
              </span>
            )}
          </div>

          {/* Compact probability row for binary markets */}
          {isBinary && leader && trailer && (
            <div className="mb-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-charcoal">{leader.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-charcoal/50">{trailer.label} {Math.round(trailer.displayPrice)}&#162;</span>
                </div>
              </div>
              {/* Dual probability bar */}
              <div className="w-full h-1.5 rounded-full bg-[#EDE8E0] overflow-hidden flex">
                <div
                  className="h-full rounded-l-full transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.max(2, leader.displayPrice)}%`,
                    background: "linear-gradient(90deg, #B8860B 0%, #D4A847 100%)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Multi-outcome: show top 2 outcomes inline */}
          {!isBinary && (
            <div className="mb-2 space-y-1">
              {sorted.slice(0, 2).map((o) => (
                <div key={o.id} className="flex items-center gap-2">
                  <span className="text-xs text-charcoal truncate w-20">{o.label}</span>
                  <div className="flex-1 h-1 rounded-full bg-[#EDE8E0] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(2, o.displayPrice)}%`,
                        background: "linear-gradient(90deg, #B8860B 0%, #D4A847 100%)",
                      }}
                    />
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-[#B8860B] w-8 text-right">
                    {Math.round(o.displayPrice)}&#162;
                  </span>
                </div>
              ))}
              {sorted.length > 2 && (
                <span className="text-[10px] text-[#8B7355]/50">+{sorted.length - 2} more</span>
              )}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 text-[11px] text-[#8B7355]/60">
            <span>{formatVolume(market.totalVolume)}</span>
            <span className="text-[#8B7355]/20">&middot;</span>
            <span>{market.uniqueBettorCount ?? 0} guest{(market.uniqueBettorCount ?? 0) !== 1 ? "s" : ""}</span>
            {openedAt && (
              <>
                <span className="text-[#8B7355]/20">&middot;</span>
                <span>{timeSince(openedAt)}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: leading price + watch */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xl font-bold tabular-nums text-[#B8860B]">
            {Math.round(leader.displayPrice)}&#162;
          </span>
          <span className="text-[10px] text-[#8B7355]/50 font-medium">
            {leader.label}
          </span>
          {/* Watch toggle */}
          <button
            onClick={(e) => void handleWatchToggle(e)}
            disabled={watchLoading}
            aria-label={isWatching ? "Unwatch market" : "Watch market"}
            className="p-0.5 rounded transition-opacity disabled:opacity-40 mt-0.5"
          >
            {isWatching ? (
              <svg className="w-3.5 h-3.5 text-[#B8860B]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-[#B8860B]/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </Link>
  );
}
