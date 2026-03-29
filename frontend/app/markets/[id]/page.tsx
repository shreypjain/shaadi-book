"use client";

/**
 * Market Detail — app/markets/[id]/page.tsx
 *
 * Shows: question, outcomes with live prices + probability bars,
 * buy form with slippage preview, recent purchases feed,
 * and a mini price history chart (sparkline).
 *
 * Redesigned: Cormorant Garamond section headers, gold accent palette,
 * burgundy live indicator, palace ivory cards.
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

// Sparkline uses gold gradient — single warm tone
const SPARKLINE_COLOR = "#B8860B";

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
        <header className="sticky top-0 z-10 bg-ivory/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="h-5 w-5 bg-gold-light rounded animate-pulse" />
            <div className="h-5 bg-gold-light rounded w-48 animate-pulse" />
          </div>
        </header>
        <main className="max-w-lg mx-auto px-4 py-4">
          <div className="rounded-xl bg-ivory-card border border-[rgba(184,134,11,0.12)] p-5 animate-pulse">
            <div className="h-6 bg-gold-light rounded w-3/4 mb-4" />
            <div className="space-y-3">
              <div className="h-2 bg-gold-light/60 rounded w-full" />
              <div className="h-2 bg-gold-light/60 rounded w-5/6" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-10 bg-ivory/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-warmGray"
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
            <p className="text-warmGray font-medium mb-2">Market not found</p>
            <button onClick={() => router.back()} className="text-[#B8860B] text-sm font-semibold">
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
      <header className="sticky top-0 z-10 bg-ivory/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-gold-light/60 transition-colors -ml-1.5"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-warmGray" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-warmGray truncate">Market</p>
          </div>
          {isActive && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[#722F37]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#722F37]" />
              Live
            </span>
          )}
          {isResolved && (
            <span className="text-xs font-semibold text-[#B8860B] rounded-full bg-gold-pale px-2 py-0.5">
              Resolved
            </span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4 animate-fade-in">

        {/* Market question */}
        <div className="rounded-xl bg-ivory-card border border-[rgba(184,134,11,0.12)] px-5 py-4 shadow-card">
          <h1 className="font-serif text-xl font-semibold text-charcoal leading-snug mb-3">
            {market.question}
          </h1>
          <MarketTags market={market} className="mb-3" />
          <div className="flex items-center gap-4 text-xs text-warmGray">
            {openedAt && <span>Opened {timeSince(openedAt)}</span>}
            <span>{formatVolume(market.totalVolume)} volume</span>
            <span>{market.outcomes.length} outcomes</span>
          </div>
        </div>

        {/* Outcomes with live prices */}
        <div className="rounded-xl bg-ivory-card border border-[rgba(184,134,11,0.12)] px-5 py-4 shadow-card">
          <h2 className="font-serif text-xs font-medium text-warmGray tracking-[0.12em] mb-4"
            style={{ fontVariant: "small-caps" }}>
            Current Odds
          </h2>
          <div className="flex flex-col gap-4">
            {market.outcomes.map((outcome: any) => {
              const livePrice = livePrices[outcome.id];
              const displayPriceCents =
                livePrice !== undefined ? livePrice : outcome.priceCents;
              const history = priceHistory[outcome.id] ?? [];
              const isWinner = outcome.isWinner === true || outcome.id === winningOutcomeId;

              return (
                <div key={outcome.id} className="space-y-1.5">
                  <ProbabilityBar
                    label={outcome.label}
                    priceCents={displayPriceCents}
                    isWinner={isWinner}
                    size="md"
                  />
                  {history.length >= 3 && (
                    <div className="opacity-40">
                      <Sparkline
                        points={history}
                        color={SPARKLINE_COLOR}
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
          <div className="rounded-xl bg-ivory-card border border-[rgba(184,134,11,0.12)] px-5 py-4 shadow-card">
            <h2 className="font-serif text-xs font-medium text-warmGray tracking-[0.12em] mb-4"
              style={{ fontVariant: "small-caps" }}>
              Place a Bet
            </h2>
            <BuyForm
              marketId={market.id}
              outcomes={market.outcomes}
              currentB={market.currentB}
              remainingCapCents={20000}
              onSuccess={handleBuySuccess}
            />
          </div>
        )}

        {/* Resolved banner */}
        {isResolved && winningOutcomeId && (
          <div className="rounded-xl bg-gold-pale border border-[rgba(184,134,11,0.25)] px-5 py-4">
            <div className="flex items-center gap-2 mb-1.5">
              <svg className="w-4 h-4 text-[#B8860B]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <h2 className="font-serif text-sm font-semibold text-[#B8860B]">Market Resolved</h2>
            </div>
            <p className="text-sm text-warmGray">
              Winner:{" "}
              <span className="font-bold text-charcoal">
                {market.outcomes.find((o: any) => o.id === winningOutcomeId)?.label ?? "Unknown"}
              </span>
              . Winning shares pay <span className="font-bold text-charcoal">$0.80</span> each (20% charity fee deducted).
            </p>
          </div>
        )}

        {/* Recent activity feed */}
        {activityFeed.length > 0 && (
          <div className="rounded-xl bg-ivory-card border border-[rgba(184,134,11,0.12)] px-5 py-4 shadow-card">
            <h2 className="font-serif text-xs font-medium text-warmGray tracking-[0.12em] mb-3"
              style={{ fontVariant: "small-caps" }}>
              Recent Activity
            </h2>
            <div className="flex flex-col gap-2">
              {activityFeed.map((item) => {
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium rounded-full px-2 py-0.5 border border-[#6B6156]/20 text-[#6B6156]">
                        {item.outcomeLabel}
                      </span>
                      <span className="text-warmGray text-xs">
                        {item.dollarAmount != null
                          ? `$${item.dollarAmount.toFixed(0)}`
                          : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-warmGray">
                      <span className="font-semibold text-[#B8860B]">
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
