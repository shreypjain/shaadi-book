"use client";

/**
 * Market Feed — app/page.tsx
 *
 * Lists active markets as cards with real-time price updates via Socket.io.
 * Pull-to-refresh reloads the market list.
 * NEW badge for markets < 5 min old, Low Activity badge for 30+ min stale.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { MarketCard } from "@/components/MarketCard";
import { trpc } from "@/lib/trpc";
import { ensureConnected, subscribeToFeed, getSocket } from "@/lib/socket";
import type { WsPriceUpdatePayload, WsMarketEventPayload } from "@/lib/api-types";

type LivePrices = Record<string, Record<string, number>>;

export default function MarketFeedPage() {
  const [livePrices, setLivePrices] = useState<LivePrices>({});
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);

  const { data: markets, isLoading, error, refetch } = trpc.market.list.useQuery(
    {},
    { refetchOnWindowFocus: false }
  );

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
  // Render
  // -------------------------------------------------------------------------

  return (
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
            className={`w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full ${
              pullY > 40 ? "animate-spin" : ""
            }`}
          />
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 bg-cream-100/95 backdrop-blur border-b border-[#e8e4df] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1a1a2e] tracking-tight">Shaadi Book</h1>
            <p className="text-xs text-[#8a8a9a]">Parsh &amp; Spoorthi &bull; Udaipur</p>
          </div>
          <button
            onClick={() => void refetch()}
            className="p-2 rounded-lg hover:bg-[#e8e4df]/60 transition-colors"
            aria-label="Refresh markets"
          >
            <svg
              className={`w-4 h-4 text-[#4a4a5a] ${
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
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 pb-24">
        {/* Loading skeleton */}
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="rounded-xl border border-[#e8e4df] bg-white p-5 animate-pulse">
                <div className="h-4 bg-[#e8e4df] rounded w-3/4 mb-3" />
                <div className="h-2 bg-[#f0ece7] rounded w-full mb-2" />
                <div className="h-2 bg-[#f0ece7] rounded w-5/6" />
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
            <div className="w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-brand-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-semibold text-[#1a1a2e]">No markets yet</p>
              <p className="text-sm text-[#8a8a9a] mt-1">
                Check back when the celebration starts!
              </p>
            </div>
          </div>
        )}

        {/* Market cards */}
        {!isLoading && !error && sortedMarkets.length > 0 && (
          <div className="flex flex-col gap-3 animate-fade-in">
            {/* Section label for active markets */}
            {sortedMarkets.some((m) => m.status === "ACTIVE") && (
              <div className="flex items-center gap-2 px-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold text-[#8a8a9a] uppercase tracking-wider">
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
  );
}
