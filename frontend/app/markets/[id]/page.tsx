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
import { api } from "@/lib/api";
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
import { MarketTags } from "@/components/MarketTags";
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
  points: number[];
  color: string;
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

// Sparkline colors aligned to outcomeColor palette (blue, amber, teal, emerald, violet)
const SPARKLINE_COLORS = ["#3b6fa3", "#d97706", "#0d9488", "#059669", "#7c3aed"];

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

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>({});

  const [market, setMarket] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!marketId) return;
    try {
      const data = await api.market.getById({ id: marketId });
      setMarket(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load market"));
    } finally {
      setIsLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!market) return;
    const initial: Record<string, number[]> = {};
    market.outcomes.forEach((o: { id: string; priceCents: number }) => {
      initial[o.id] = [o.priceCents];
    });
    setPriceHistory(initial);
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
        setPriceHistory((prev) => {
          const next = { ...prev };
          payload.prices.forEach(({ outcomeId, priceCents }) => {
            const hist = [...(prev[outcomeId] ?? []), priceCents];
            next[outcomeId] = hist.slice(-20);
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
        void refetch();
      }
    });

    return () => {
      unsubMarket();
      unsubFeed();
    };
  }, [marketId, refetch]);

  const handleBuySuccess = useCallback(() => {
    void refetch();
  }, [refetch]);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 bg-cream-100/95 backdrop-blur border-b border-[#e8e4df] px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="h-5 w-5 bg-[#e8e4df] rounded animate-pulse" />
            <div className="h-5 bg-[#e8e4df] rounded w-48 animate-pulse" />
          </div>
        </header>
        <main className="max-w-lg mx-auto px-4 py-4">
          <div className="rounded-xl bg-white border border-[#e8e4df] p-5 animate-pulse">
            <div className="h-6 bg-[#e8e4df] rounded w-3/4 mb-4" />
            <div className="space-y-3">
              <div className="h-2 bg-[#f0ece7] rounded w-full" />
              <div className="h-2 bg-[#f0ece7] rounded w-5/6" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-10 bg-cream-100/95 backdrop-blur border-b border-[#e8e4df] px-4 py-3">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-[#4a4a5a]"
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
            <p className="text-[#4a4a5a] font-medium mb-2">Market not found</p>
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
      <header className="sticky top-0 z-10 bg-cream-100/95 backdrop-blur border-b border-[#e8e4df] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-[#e8e4df]/60 transition-colors -ml-1.5"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-[#4a4a5a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#8a8a9a] truncate">Market</p>
          </div>
          {isActive && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
          {isResolved && (
            <span className="text-xs font-semibold text-[#8a6d30] rounded-full bg-[#f5efd9] px-2 py-0.5">
              Resolved
            </span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4 animate-fade-in">

        {/* Market question */}
        <div className="rounded-xl bg-white border border-[#e8e4df] px-5 py-4 shadow-card">
          <h1 className="text-xl font-bold text-[#1a1a2e] leading-snug mb-3 tracking-tight">
            {market.question}
          </h1>
          <MarketTags market={market} className="mb-3" />
          <div className="flex items-center gap-4 text-xs text-[#8a8a9a]">
            {openedAt && <span>Opened {timeSince(openedAt)}</span>}
            <span>{formatVolume(market.totalVolume)} volume</span>
            <span className="font-semibold text-[#1e3a5f]">
              Pool: ${(market.totalPool ?? market.totalVolume).toFixed(2)}
            </span>
            <span>{market.outcomes.length} outcomes</span>
          </div>
        </div>

        {/* Outcomes with live prices */}
        <div className="rounded-xl bg-white border border-[#e8e4df] px-5 py-4 shadow-card">
          <h2 className="text-xs font-semibold text-[#8a8a9a] uppercase tracking-wider mb-4">
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
                <div key={outcome.id} className="space-y-1.5">
                  <ProbabilityBar
                    label={outcome.label}
                    priceCents={displayPriceCents}
                    barColor={colors.bar}
                    textColor={colors.text}
                    trackColor={colors.light}
                    isWinner={isWinner}
                    size="md"
                  />
                  {history.length >= 3 && (
                    <div className="opacity-50">
                      <Sparkline
                        points={history}
                        color={SPARKLINE_COLORS[i % SPARKLINE_COLORS.length]!}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Buy form */}
        {isActive && (
          <div className="rounded-xl bg-white border border-[#e8e4df] px-5 py-4 shadow-card">
            <h2 className="text-xs font-semibold text-[#8a8a9a] uppercase tracking-wider mb-4">
              Place a Bet
            </h2>
            <BuyForm
              marketId={market.id}
              outcomes={market.outcomes}
              currentB={market.currentB}
              totalPool={market.totalPool ?? market.totalVolume ?? 0}
              remainingCapCents={20000}
              onSuccess={handleBuySuccess}
            />
          </div>
        )}

        {/* Resolved banner */}
        {isResolved && winningOutcomeId && (() => {
          const winningOutcome = market.outcomes.find((o) => o.id === winningOutcomeId);
          const totalPool = market.totalPool ?? market.totalVolume ?? 0;
          const totalWinningShares = winningOutcome?.sharesSold ?? 0;
          const payoutPerShare =
            totalWinningShares > 0 ? totalPool / totalWinningShares : 0;
          return (
            <div className="rounded-xl bg-[#f5efd9] border border-[#c8a45c]/30 px-5 py-4">
              <div className="flex items-center gap-2 mb-1.5">
                <svg className="w-4 h-4 text-[#c8a45c]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <h2 className="text-sm font-bold text-[#8a6d30]">Market Resolved</h2>
              </div>
              <p className="text-sm text-[#8a6d30]">
                Winner:{" "}
                <span className="font-bold">
                  {winningOutcome?.label ?? "Unknown"}
                </span>
                .
              </p>
              {totalWinningShares > 0 ? (
                <p className="text-sm text-[#8a6d30] mt-1">
                  Pool of{" "}
                  <span className="font-bold">${totalPool.toFixed(2)}</span>{" "}
                  split among{" "}
                  <span className="font-bold">{totalWinningShares.toFixed(2)} winning shares</span>{" "}
                  (
                  <span className="font-bold">${payoutPerShare.toFixed(4)}/share</span>
                  ).
                </p>
              ) : (
                <p className="text-sm text-[#8a6d30] mt-1">
                  No bets on the winning outcome —{" "}
                  <span className="font-bold">all bets refunded</span>.
                </p>
              )}
            </div>
          );
        })()}

        {/* Recent activity feed */}
        {activityFeed.length > 0 && (
          <div className="rounded-xl bg-white border border-[#e8e4df] px-5 py-4 shadow-card">
            <h2 className="text-xs font-semibold text-[#8a8a9a] uppercase tracking-wider mb-3">
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
                      <span className="text-[#8a8a9a] text-xs">
                        {item.dollarAmount != null
                          ? `$${item.dollarAmount.toFixed(0)}`
                          : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#8a8a9a]">
                      <span className="font-medium text-[#4a4a5a]">
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
