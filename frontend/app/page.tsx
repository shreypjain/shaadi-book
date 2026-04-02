"use client";

/**
 * Market Feed — app/page.tsx
 *
 * Redesigned for 10+ markets: hero card for the hottest market,
 * compact card list below, sort pills (Hot, Popular, Newest, Closing Soon).
 * Pull-to-refresh, real-time price updates, filter tabs by event/family.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MarketCard } from "@/components/MarketCard";
import { SuggestMarketModal } from "@/components/SuggestMarketModal";
import { api } from "@/lib/api";
import { ensureConnected, subscribeToFeed, getSocket } from "@/lib/socket";
import { getStoredUser } from "@/lib/auth";
import type { WsPriceUpdatePayload, WsMarketEventPayload } from "@/lib/api-types";
import { EVENT_TAGS, FAMILY_SIDES, type EventTag, type FamilySide } from "@/lib/api-types";

type LivePrices = Record<string, Record<string, number>>;
type FilterMode = "event" | "family";
type SortMode = "hot" | "popular" | "newest" | "closing";

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "hot", label: "Hot" },
  { key: "popular", label: "Popular" },
  { key: "newest", label: "Newest" },
  { key: "closing", label: "Closing Soon" },
];

export default function MarketFeedPage() {
  const [livePrices, setLivePrices] = useState<LivePrices>({});
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const [markets, setMarkets] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const isLoggedIn = typeof window !== "undefined" ? !!getStoredUser() : false;

  // Filter & sort state
  const [filterMode, setFilterMode] = useState<FilterMode>("event");
  const [activeEventTag, setActiveEventTag] = useState<EventTag | null>(null);
  const [activeFamilySide, setActiveFamilySide] = useState<FamilySide | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("hot");

  const refetch = useCallback(async () => {
    try {
      const data = await api.market.list({
        eventTag: activeEventTag ?? undefined,
        familySide: activeFamilySide ?? undefined,
      });
      setMarkets(data as any[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load markets"));
    } finally {
      setIsLoading(false);
    }
  }, [activeEventTag, activeFamilySide]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // ---------------------------------------------------------------------------
  // WebSocket: global feed + per-market price subscriptions
  // ---------------------------------------------------------------------------

  useEffect(() => {
    ensureConnected();

    const unsubFeed = subscribeToFeed(
      (event: WsMarketEventPayload) => {
        if (["created", "resolved", "paused", "voided"].includes(event.type)) {
          void refetch();
        }
      }
    );

    return () => { unsubFeed(); };
  }, [refetch]);

  useEffect(() => {
    if (!markets?.length) return;
    const socket = getSocket();
    const handlers: Array<(p: WsPriceUpdatePayload) => void> = [];

    markets.forEach((market) => {
      const channel = `market:${market.id}:prices`;
      socket.emit("subscribe", channel);

      const handler = (payload: WsPriceUpdatePayload) => {
        if (payload.marketId !== market.id) return;
        setLivePrices((prev) => {
          const marketPrices: Record<string, number> = { ...(prev[market.id] ?? {}) };
          payload.prices.forEach(({ outcomeId, priceCents }) => {
            marketPrices[outcomeId] = priceCents;
          });
          return { ...prev, [market.id]: marketPrices };
        });
      };

      socket.on("priceUpdate", handler);
      handlers.push(handler);
    });

    return () => {
      markets.forEach((market, i) => {
        const channel = `market:${market.id}:prices`;
        socket.emit("unsubscribe", channel);
        if (handlers[i]) socket.off("priceUpdate", handlers[i]!);
      });
    };
  }, [markets]);

  // ---------------------------------------------------------------------------
  // Pull-to-refresh
  // ---------------------------------------------------------------------------

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const currentY = e.touches[0]?.clientY ?? 0;
    const dy = currentY - touchStartY.current;
    if (dy > 0 && window.scrollY === 0) {
      setPullY(Math.min(dy * 0.4, 60));
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (pullY > 40) {
      setIsRefreshing(true);
      await refetch();
      setIsRefreshing(false);
    }
    setPullY(0);
  }, [pullY, refetch]);

  // ---------------------------------------------------------------------------
  // Sorting & grouping
  // ---------------------------------------------------------------------------

  const [archiveExpanded, setArchiveExpanded] = useState(false);

  const allMarkets = markets ?? [];
  const liveMarkets = allMarkets.filter((m) =>
    ["ACTIVE", "PENDING", "PAUSED"].includes(m.status)
  );
  const archivedMarkets = allMarkets.filter((m) =>
    ["RESOLVED", "VOIDED"].includes(m.status)
  );

  // Sort live markets by selected mode
  const sortedLiveMarkets = useMemo(() => {
    const items = [...liveMarkets];
    switch (sortMode) {
      case "hot":
        // Score: volume * recency. Higher volume + more recent = hotter
        return items.sort((a, b) => {
          const recencyA = a.openedAt ? Date.now() - new Date(a.openedAt).getTime() : Infinity;
          const recencyB = b.openedAt ? Date.now() - new Date(b.openedAt).getTime() : Infinity;
          const scoreA = Math.log((a.totalVolume || 0) + 1) + Math.max(0, 10 - recencyA / 3_600_000);
          const scoreB = Math.log((b.totalVolume || 0) + 1) + Math.max(0, 10 - recencyB / 3_600_000);
          return scoreB - scoreA;
        });
      case "popular":
        return items.sort((a, b) => (b.uniqueBettorCount ?? 0) - (a.uniqueBettorCount ?? 0));
      case "newest":
        return items.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case "closing":
        // Markets with resolvedAt or scheduledOpenAt sooner come first
        // For now, sort by creation date ascending (oldest first = likely closing soonest)
        return items.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      default:
        return items;
    }
  }, [liveMarkets, sortMode]);

  // Hero = first market in hot sort (highest score)
  const heroMarket = sortedLiveMarkets.length >= 3 ? sortedLiveMarkets[0] : null;
  const remainingMarkets = heroMarket
    ? sortedLiveMarkets.slice(1)
    : sortedLiveMarkets;

  // ---------------------------------------------------------------------------
  // Filter helpers
  // ---------------------------------------------------------------------------

  function selectEventTag(tag: EventTag) {
    setActiveEventTag((prev) => (prev === tag ? null : tag));
    setActiveFamilySide(null);
  }

  function selectFamilySide(side: FamilySide) {
    setActiveFamilySide((prev) => (prev === side ? null : side));
    setActiveEventTag(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
    <SuggestMarketModal
      isOpen={showSuggestModal}
      onClose={() => setShowSuggestModal(false)}
    />
    <div
      className="min-h-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => void handleTouchEnd()}
    >
      {/* Pull-to-refresh indicator */}
      {pullY > 0 && (
        <div
          className="flex justify-center pt-4 transition-all"
          style={{ height: pullY }}
        >
          <div
            className={`w-5 h-5 border-2 border-gold-300 border-t-gold rounded-full ${
              pullY > 40 ? "animate-spin" : ""
            }`}
          />
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 bg-ivory/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-serif text-xl font-semibold text-charcoal tracking-[0.05em] uppercase">
              Shaadi Book
            </h1>
            <p className="font-sans text-xs italic text-warmGray font-light">
              Parsh &amp; Spoorthi &bull; Udaipur
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isLoggedIn && (
              <button
                onClick={() => setShowSuggestModal(true)}
                className="flex items-center gap-1.5 rounded-full border border-[#B8860B]/40 bg-transparent px-4 py-2 text-sm font-medium text-[#B8860B] hover:bg-[#B8860B] hover:text-white transition-all duration-200"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Suggest
              </button>
            )}
          <button
            onClick={() => void refetch()}
            className="p-2 rounded-lg hover:bg-gold-light/60 transition-colors"
            aria-label="Refresh markets"
          >
            <svg
              className={`w-4 h-4 text-warmGray ${
                isRefreshing ? "animate-spin" : ""
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="max-w-lg mx-auto mt-3 space-y-2">
          {/* Mode selector */}
          <div className="flex gap-4 border-b border-[rgba(184,134,11,0.12)]">
            <button
              onClick={() => { setFilterMode("event"); setActiveFamilySide(null); }}
              className={`text-sm pb-2 transition-colors ${
                filterMode === "event"
                  ? "text-charcoal font-semibold border-b-2 border-gold"
                  : "text-warmGray font-medium hover:text-charcoal"
              }`}
            >
              By Event
            </button>
            <button
              onClick={() => { setFilterMode("family"); setActiveEventTag(null); }}
              className={`text-sm pb-2 transition-colors ${
                filterMode === "family"
                  ? "text-charcoal font-semibold border-b-2 border-gold"
                  : "text-warmGray font-medium hover:text-charcoal"
              }`}
            >
              By Family
            </button>
            {(activeEventTag || activeFamilySide) && (
              <button
                onClick={() => { setActiveEventTag(null); setActiveFamilySide(null); }}
                className="text-xs text-warmGray hover:text-charcoal underline ml-auto pb-2"
              >
                Clear filter
              </button>
            )}
          </div>

          {/* Event tag pills */}
          {filterMode === "event" && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {EVENT_TAGS.map((tag) => {
                const isActive = activeEventTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => selectEventTag(tag)}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-sans font-normal border transition-all duration-200 ${
                      isActive
                        ? "border-transparent bg-[#B8860B] text-white shadow-sm"
                        : "border-[#D4C5A9]/40 bg-transparent text-[#6B6156] hover:border-[#B8860B]/50 hover:text-[#B8860B]"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}

          {/* Family side pills */}
          {filterMode === "family" && (
            <div className="flex gap-2 flex-wrap">
              {FAMILY_SIDES.map((side) => {
                const isActive = activeFamilySide === side;
                const label =
                  side === "Spoorthi"
                    ? "Spoorthi's side"
                    : side === "Parsh"
                    ? "Parsh's side"
                    : "Both sides";
                return (
                  <button
                    key={side}
                    onClick={() => selectFamilySide(side)}
                    className={`rounded-full px-4 py-1.5 text-sm font-sans font-normal border transition-all duration-200 ${
                      isActive
                        ? "border-transparent bg-[#B8860B] text-white shadow-sm"
                        : "border-[#D4C5A9]/40 bg-transparent text-[#6B6156] hover:border-[#B8860B]/50 hover:text-[#B8860B]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 pb-24">
        {/* Sort pills */}
        {!isLoading && !error && liveMarkets.length > 0 && (
          <div className="flex gap-2 mb-4 overflow-x-auto scrollbar-none">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSortMode(opt.key)}
                className={`shrink-0 rounded-full px-3.5 py-1 text-xs font-medium transition-all duration-200 ${
                  sortMode === opt.key
                    ? "bg-charcoal text-white shadow-sm"
                    : "bg-[#F5F1EB] text-[#6B6156] hover:bg-[#EDE8E0]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="rounded-xl border border-[rgba(184,134,11,0.12)] bg-ivory-card p-4 animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="h-4 bg-gold-light rounded w-3/4 mb-2" />
                    <div className="h-1.5 bg-gold-light/60 rounded w-full mb-2" />
                    <div className="h-3 bg-gold-light/40 rounded w-1/2" />
                  </div>
                  <div className="h-8 w-10 bg-gold-light/60 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <div className="rounded-xl border border-[#dc2626]/20 bg-red-50 p-6 text-center">
            <p className="text-sm text-[#dc2626] font-medium mb-3">
              Couldn&apos;t load markets
            </p>
            <button
              onClick={() => void refetch()}
              className="text-sm font-semibold text-[#dc2626] underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && liveMarkets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-full bg-gold-pale flex items-center justify-center">
              <svg className="w-8 h-8 text-gold/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-semibold text-charcoal">
                {activeEventTag || activeFamilySide
                  ? "No markets match this filter"
                  : archivedMarkets.length > 0
                  ? "All markets have been resolved"
                  : "No markets yet"}
              </p>
              <p className="text-sm text-warmGray mt-1">
                {activeEventTag || activeFamilySide
                  ? "Try a different event or clear the filter."
                  : archivedMarkets.length > 0
                  ? "Check the archive below for results."
                  : "Check back when the celebration starts."}
              </p>
            </div>
          </div>
        )}

        {/* Live markets */}
        {!isLoading && !error && sortedLiveMarkets.length > 0 && (
          <div className="flex flex-col gap-2.5 animate-fade-in">
            {/* Section label */}
            <div className="flex items-center justify-between px-0.5 mb-0.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B8860B]/50 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#B8860B]" />
                </span>
                <span className="font-serif text-xs font-medium tracking-[0.2em] uppercase"
                  style={{ color: "rgba(184,134,11,0.70)" }}>
                  Live Markets
                </span>
              </div>
              <span className="text-[11px] text-[#8B7355]/50">
                {sortedLiveMarkets.length} market{sortedLiveMarkets.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Hero card */}
            {heroMarket && (
              <MarketCard
                key={heroMarket.id}
                market={heroMarket}
                livePrices={livePrices[heroMarket.id]}
                hero
              />
            )}

            {/* Compact cards */}
            {remainingMarkets.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                livePrices={livePrices[market.id]}
              />
            ))}
          </div>
        )}

        {/* Archive section */}
        {!isLoading && !error && archivedMarkets.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setArchiveExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-1 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-serif text-xs font-medium tracking-[0.2em] uppercase"
                  style={{ color: "rgba(184,134,11,0.70)" }}>
                  Archive
                </span>
                <span className="text-xs text-warmGray">
                  ({archivedMarkets.length})
                </span>
              </div>
              <svg
                className={`w-4 h-4 text-warmGray transition-transform ${archiveExpanded ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {archiveExpanded && (
              <div className="flex flex-col gap-2.5 mt-2">
                {archivedMarkets.map((market) => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    livePrices={livePrices[market.id]}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
    </>
  );
}
