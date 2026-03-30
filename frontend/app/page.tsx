"use client";

/**
 * Market Feed — app/page.tsx
 *
 * Lists active markets as cards with real-time price updates via Socket.io.
 * Pull-to-refresh reloads the market list.
 * NEW badge for markets < 5 min old, Low Activity badge for 30+ min stale.
 * Filter tabs by wedding event or family side.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { MarketCard } from "@/components/MarketCard";
import { SuggestMarketModal } from "@/components/SuggestMarketModal";
import { api } from "@/lib/api";
import { ensureConnected, subscribeToFeed, getSocket } from "@/lib/socket";
import { getStoredUser } from "@/lib/auth";
import type { WsPriceUpdatePayload, WsMarketEventPayload } from "@/lib/api-types";
import { EVENT_TAGS, FAMILY_SIDES, type EventTag, type FamilySide } from "@/lib/api-types";

type LivePrices = Record<string, Record<string, number>>;
type FilterMode = "event" | "family";

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

  // Active filter state
  const [filterMode, setFilterMode] = useState<FilterMode>("event");
  const [activeEventTag, setActiveEventTag] = useState<EventTag | null>(null);
  const [activeFamilySide, setActiveFamilySide] = useState<FamilySide | null>(null);

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

  // -------------------------------------------------------------------------
  // WebSocket: global feed + per-market price subscriptions
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Pull-to-refresh
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Sorted markets: ACTIVE first, then PAUSED, then RESOLVED
  // -------------------------------------------------------------------------

  const sortedMarkets = [...(markets ?? [])].sort((a, b) => {
    const order = { ACTIVE: 0, PENDING: 1, PAUSED: 2, RESOLVED: 3, VOIDED: 4 };
    const ao = order[a.status as keyof typeof order] ?? 5;
    const bo = order[b.status as keyof typeof order] ?? 5;
    return ao !== bo ? ao - bo : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // -------------------------------------------------------------------------
  // Filter helpers
  // -------------------------------------------------------------------------

  function selectEventTag(tag: EventTag) {
    setActiveEventTag((prev) => (prev === tag ? null : tag));
    setActiveFamilySide(null);
  }

  function selectFamilySide(side: FamilySide) {
    setActiveFamilySide((prev) => (prev === side ? null : side));
    setActiveEventTag(null);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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
        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="rounded-xl border border-[rgba(184,134,11,0.12)] bg-ivory-card p-5 animate-pulse">
                <div className="h-4 bg-gold-light rounded w-3/4 mb-3" />
                <div className="h-2 bg-gold-light/60 rounded w-full mb-2" />
                <div className="h-2 bg-gold-light/60 rounded w-5/6" />
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
        {!isLoading && !error && sortedMarkets.length === 0 && (
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
                  : "No markets yet"}
              </p>
              <p className="text-sm text-warmGray mt-1">
                {activeEventTag || activeFamilySide
                  ? "Try a different event or clear the filter."
                  : "Check back when the celebration starts."}
              </p>
            </div>
          </div>
        )}

        {/* Market cards */}
        {!isLoading && !error && sortedMarkets.length > 0 && (
          <div className="flex flex-col gap-3 animate-fade-in">
            {/* Section label for active markets */}
            {sortedMarkets.some((m) => m.status === "ACTIVE") && (
              <div className="flex items-center gap-2 px-1 pt-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#B8860B] animate-pulse-gold" />
                <span className="font-serif text-xs font-medium tracking-[0.2em] uppercase"
                  style={{ color: "rgba(184,134,11,0.70)" }}>
                  Live Markets
                </span>
              </div>
            )}

            {sortedMarkets.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                livePrices={livePrices[market.id]}
              />
            ))}
          </div>
        )}
      </main>
    </div>
    </>
  );
}
