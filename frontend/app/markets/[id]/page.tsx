"use client";

/**
 * Market Detail — app/markets/[id]/page.tsx
 *
 * Shows: question, outcomes with live prices + probability bars,
 * buy form with slippage preview, recent purchases feed,
 * and a mini price history chart (sparkline).
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { BuyForm } from "@/components/BuyForm";
import { trpc } from "@/lib/trpc";
import {
  ensureConnected,
  subscribeToMarket,
  subscribeToFeed,
  getSocket,
} from "@/lib/socket";
import {
  timeSince,
  formatVolume,
  outcomeColor,
} from "@/lib/utils";
import type {
  WsPriceUpdatePayload,
  WsPurchasePayload,
  WsMarketEventPayload,
  RecentPurchase,
} from "@/lib/api-types";

// ---------------------------------------------------------------------------
// Mini sparkline chart — simple SVG price history
// ---------------------------------------------------------------------------

interface SparklineProps {
  points: number[]; // price values 0–100
  color: string; // hex or named color
}

function Sparkline({ points, color }: SparklineProps) {
  if (points.length < 2) return null;

  const W = 200;
  const H = 40;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - ((p - min) / range) * H;
    return `${x},${y}`;
  });

  const pathD = `M${coords.join(" L")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Activity feed item
// ---------------------------------------------------------------------------

interface ActivityItem {
  id: string;
  type: "purchase";
  outcomeLabel: string;
  dollarAmount?: number;
  priceAfterCents: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const marketId = params?.id ?? "";

  // Live price overrides: outcomeId → priceCents
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  // Recent activity feed (WebSocket events prepended)
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  // Price history per outcome: outcomeId → priceCents[]
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>({});

  // tRPC queries
  const {
    data: market,
    isLoading,
    error,
    refetch,
  } = trpc.market.getById.useQuery(
    { id: marketId },
    { enabled: !!marketId, refetchOnWindowFocus: false }
  );

  // Seed price history from initial market data
  useEffect(() => {
    if (!market) return;
    const initial: Record<string, number[]> = {};
    market.outcomes.forEach((o) => {
      initial[o.id] = [o.priceCents];
    });
    setPriceHistory(initial);
    // Seed activity feed from recent purchases
    if (market.recentPurchases?.length) {
      setActivityFeed(
        (market.recentPurchases as RecentPurchase[]).slice(0, 10).map((p) => ({
          id: p.id,
          type: "purchase" as const,
          outcomeLabel: p.outcomeLabel,
          priceAfterCents: Math.round(p.priceAfter * 100),
          timestamp: new Date(p.createdAt).getTime(),
        }))
      );
    }
  }, [market]);

  // -------------------------------------------------------------------------
  // WebSocket subscriptions
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!marketId) return;

    ensureConnected();

    const unsubMarket = subscribeToMarket(marketId, {
      onPriceUpdate: (payload: WsPriceUpdatePayload) => {
        const priceMap: Record<string, number> = {};
        payload.prices.forEach(({ outcomeId, priceCents }) => {
          priceMap[outcomeId] = priceCents;
        });
        setLivePrices((prev) => ({ ...prev, ...priceMap }));
        // Append to price history
        setPriceHistory((prev) => {
          const next = { ...prev };
          payload.prices.forEach(({ outcomeId, priceCents }) => {
            const hist = [...(prev[outcomeId] ?? []), priceCents];
            next[outcomeId] = hist.slice(-20); // keep last 20 points
          });
          return next;
        });
      },
      onPurchase: (payload: WsPurchasePayload) => {
        const item: ActivityItem = {
          id: `ws-${payload.timestamp}`,
          type: "purchase",
          outcomeLabel: payload.outcomeLabel,
          dollarAmount: payload.dollarAmount,
          priceAfterCents: payload.priceAfterCents,
          timestamp: payload.timestamp,
        };
        setActivityFeed((prev) => [item, ...prev].slice(0, 20));
      },
    });

    const unsubFeed = subscribeToFeed((event: WsMarketEventPayload) => {
      if (event.marketId === marketId) {
        // Market state changed — refetch to get latest status
        void refetch();
      }
    });

    return () => {
      unsubMarket();
      unsubFeed();
    };
  }, [marketId, refetch]);

  // -------------------------------------------------------------------------
  // Buy form success handler
  // -------------------------------------------------------------------------

  const handleBuySuccess = useCallback(() => {
    void refetch();
  }, [refetch]);

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 bg-amber-50/95 backdrop-blur border-b border-amber-100 px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="h-5 w-5 bg-gray-200 rounded animate-pulse" />
            <div className="h-5 bg-gray-200 rounded w-48 animate-pulse" />
          </div>
        </header>
        <main className="max-w-lg mx-auto px-4 py-4">
          <div className="rounded-2xl bg-white border p-5 animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-3/4 mb-4" />
            <div className="space-y-3">
              <div className="h-2 bg-gray-100 rounded w-full" />
              <div className="h-2 bg-gray-100 rounded w-5/6" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-10 bg-amber-50/95 backdrop-blur border-b border-amber-100 px-4 py-3">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <p className="text-gray-600 font-medium mb-2">Market not found</p>
            <button onClick={() => router.back()} className="text-brand-600 text-sm font-semibold">
              Go back
            </button>
          </div>
        </main>
      </div>
    );
  }

  const openedAt = market.openedAt ? new Date(market.openedAt) : null;
  const isActive = market.status === "ACTIVE";
  const isResolved = market.status === "RESOLVED";
  const winningOutcomeId = market.winningOutcomeId;

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-amber-50/95 backdrop-blur border-b border-amber-100 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-amber-100 transition-colors -ml-1.5"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 truncate">Market</p>
          </div>
          {isActive && (
            <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          )}
          {isResolved && (
            <span className="text-xs font-semibold text-amber-600 rounded-full bg-amber-100 px-2 py-0.5">
              Resolved
            </span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4 animate-fade-in">

        {/* Market question */}
        <div className="rounded-2xl bg-white border px-5 py-4 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900 leading-snug mb-3">
            {market.question}
          </h1>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            {openedAt && <span>Opened {timeSince(openedAt)}</span>}
            <span>{formatVolume(market.totalVolume)} volume</span>
            <span>{market.outcomes.length} outcomes</span>
          </div>
        </div>

        {/* Outcomes with live prices */}
        <div className="rounded-2xl bg-white border px-5 py-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Current Odds
          </h2>
          <div className="flex flex-col gap-4">
            {market.outcomes.map((outcome, i) => {
              const livePrice = livePrices[outcome.id];
              const displayPriceCents =
                livePrice !== undefined ? livePrice : outcome.priceCents;
              const colors = outcomeColor(i);
              const history = priceHistory[outcome.id] ?? [];
              const isWinner = outcome.isWinner === true || outcome.id === winningOutcomeId;

              return (
                <div key={outcome.id} className="space-y-2">
                  <ProbabilityBar
                    label={outcome.label}
                    priceCents={displayPriceCents}
                    barColor={colors.bar}
                    textColor={colors.text}
                    trackColor={colors.light}
                    isWinner={isWinner}
                    size="md"
                  />
                  {/* Mini sparkline */}
                  {history.length >= 3 && (
                    <div className="opacity-60">
                      <Sparkline
                        points={history}
                        color={
                          i === 0
                            ? "#f43f5e"
                            : i === 1
                            ? "#f59e0b"
                            : i === 2
                            ? "#8b5cf6"
                            : "#10b981"
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Buy form — only show for active markets */}
        {isActive && (
          <div className="rounded-2xl bg-white border px-5 py-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Place a Bet
            </h2>
            <BuyForm
              marketId={market.id}
              outcomes={market.outcomes}
              currentB={market.currentB}
              remainingCapCents={5000} // $50 max — TODO: subtract user's existing spend
              onSuccess={handleBuySuccess}
            />
          </div>
        )}

        {/* Resolved banner */}
        {isResolved && winningOutcomeId && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-amber-500 text-xl">🏆</span>
              <h2 className="text-sm font-bold text-amber-800">Market Resolved</h2>
            </div>
            <p className="text-sm text-amber-700">
              Winner:{" "}
              <span className="font-bold">
                {market.outcomes.find((o) => o.id === winningOutcomeId)?.label ?? "Unknown"}
              </span>
              . Winning shares pay <span className="font-bold">$0.80</span> each (20% charity fee deducted).
            </p>
          </div>
        )}

        {/* Recent activity feed */}
        {activityFeed.length > 0 && (
          <div className="rounded-2xl bg-white border px-5 py-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Recent Activity
            </h2>
            <div className="flex flex-col gap-2">
              {activityFeed.map((item) => {
                const outcomeIdx = market.outcomes.findIndex(
                  (o) => o.label === item.outcomeLabel
                );
                const colors = outcomeColor(outcomeIdx >= 0 ? outcomeIdx : 0);
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-semibold rounded-full px-2 py-0.5 ${colors.light} ${colors.text}`}
                      >
                        {item.outcomeLabel}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {item.dollarAmount != null
                          ? `$${item.dollarAmount.toFixed(0)}`
                          : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="font-medium text-gray-600">
                        → {item.priceAfterCents}¢
                      </span>
                      <span>{timeSince(new Date(item.timestamp))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
