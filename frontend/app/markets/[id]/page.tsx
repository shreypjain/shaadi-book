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
import { PriceChart } from "@/components/PriceChart";
import type { PricePoint } from "@/components/PriceChart";
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
// Positions data types
// ---------------------------------------------------------------------------

interface PositionEntry {
  userId: string;
  userName: string | null;
  dominantOutcomeId: string;
  dominantOutcomeLabel: string;
  netSharesByOutcome: Record<string, { shares: number; label: string }>;
  totalDeployed: number;
  costBasis: number;
  tradeCount: number;
}

interface PositionsData {
  positions: PositionEntry[];
  totalVolume: number;
  outcomeVolumes: Record<string, { label: string; totalBet: number }>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const marketId = params?.id ?? "";

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [priceHistory, setPriceHistory] = useState<Record<string, number[]>>({});
  const [positionsData, setPositionsData] = useState<PositionsData | null>(null);
  const [positionsLoading, setPositionsLoading] = useState(false);

  const [chartHours, setChartHours] = useState<1 | 2 | 4>(1);
  const [chartData, setChartData] = useState<Record<string, PricePoint[]>>({});

  const [market, setMarket] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | undefined>(undefined);
  /** Map of outcomeId → { shares, outcomeSharesSold } for the current user */
  const [myOutcomeShares, setMyOutcomeShares] = useState<
    Record<string, { shares: number; outcomeSharesSold: number }>
  >({});
  const [isWatching, setIsWatching] = useState(false);
  const [watchLoading, setWatchLoading] = useState(false);



  const refetchBalance = useCallback(async () => {
    try {
      const { balanceCents: cents } = await api.wallet.balance();
      setBalanceCents(cents);
    } catch {
      // Non-fatal — balance display is best-effort
    }
  }, []);

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
    void refetchBalance();
  }, [refetch, refetchBalance]);

  // Fetch user positions to display ownership % per outcome
  useEffect(() => {
    api.bets.myPositions().then((positions) => {
      const map: Record<string, { shares: number; outcomeSharesSold: number }> = {};
      for (const pos of positions) {
        if (pos.marketId === marketId && pos.shares > 0) {
          map[pos.outcomeId] = {
            shares: pos.shares,
            outcomeSharesSold: pos.outcomeSharesSold,
          };
        }
      }
      setMyOutcomeShares(map);
    }).catch(() => {
      // Non-fatal — ownership % is best-effort
    });
  }, [marketId]);

  useEffect(() => {
    if (!market) return;
    // Sync isWatching from market data
    setIsWatching(!!market.isWatching);
    const initial: Record<string, number[]> = {};
    market.outcomes.forEach((o: { id: string; priceCents: number }) => {
      initial[o.id] = [o.priceCents];
    });
    setPriceHistory(initial);
  }, [market]);

  // Fetch full price history from the API (re-fetches when marketId or chartHours changes)
  useEffect(() => {
    if (!marketId) return;
    api.market
      .priceHistory({ marketId, hours: chartHours })
      .then((data) => setChartData(data))
      .catch(() => {
        // Non-fatal — chart will show empty state
      });
  }, [marketId, chartHours]);

  const fetchPositions = useCallback(async () => {
    if (!marketId) return;
    setPositionsLoading(true);
    try {
      const data = await api.market.positions({ marketId });
      setPositionsData(data);
    } catch {
      // Non-fatal
    } finally {
      setPositionsLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    void fetchPositions();
  }, [fetchPositions]);

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
        // Append live price updates to the full chart data
        const now = new Date().toISOString();
        setChartData((prev) => {
          const next = { ...prev };
          payload.prices.forEach(({ outcomeId, priceCents }) => {
            next[outcomeId] = [...(prev[outcomeId] ?? []), { priceCents, time: now }];
          });
          return next;
        });
      },
      onPurchase: (_payload: WsPurchasePayload) => {
        // Re-fetch positions so the leaderboard stays live
        void fetchPositions();
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
  }, [marketId, refetch, fetchPositions]);

  const handleBuySuccess = useCallback(() => {
    void refetch();
    void refetchBalance();
    void fetchPositions();
  }, [refetch, refetchBalance, fetchPositions]);

  const handleWatchToggle = useCallback(async () => {
    if (watchLoading) return;
    setWatchLoading(true);
    try {
      if (isWatching) {
        await api.market.unwatch({ marketId });
        setIsWatching(false);
      } else {
        await api.market.watch({ marketId });
        setIsWatching(true);
      }
    } catch {
      // Non-fatal — may be unauthenticated
    } finally {
      setWatchLoading(false);
    }
  }, [isWatching, watchLoading, marketId]);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-10 bg-ivory/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <div className="h-5 w-5 bg-[#EDE8E0] rounded animate-pulse" />
            <div className="h-5 bg-[#EDE8E0] rounded w-48 animate-pulse" />
          </div>
        </header>
        <main className="max-w-lg mx-auto px-4 py-4">
          <div className="rounded-2xl bg-white/80 border border-[rgba(184,134,11,0.08)] p-6 animate-pulse shadow-[0_2px_16px_rgba(139,109,71,0.06)]">
            <div className="h-6 bg-[#EDE8E0] rounded w-3/4 mb-4" />
            <div className="space-y-3">
              <div className="h-1.5 bg-[#EDE8E0]/80 rounded w-full" />
              <div className="h-1.5 bg-[#EDE8E0]/80 rounded w-5/6" />
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
              className="flex items-center gap-2 text-[#6B6156]"
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
  const isPending = market.status === "PENDING";
  const scheduledAt = market.scheduledOpenAt ? new Date(market.scheduledOpenAt) : null;
  const winningOutcomeId = market.winningOutcomeId;

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-ivory/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-[#EDE8E0]/60 transition-colors -ml-1.5"
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
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
          {isPending && (
            <span className="text-xs font-semibold text-[#B8860B] rounded-full bg-[#FFF8E7] px-2 py-0.5">
              Coming Soon
            </span>
          )}
          {isResolved && (
            <span className="text-xs font-semibold text-[#8a6d30] rounded-full bg-[#f5efd9] px-2 py-0.5">
              Resolved
            </span>
          )}
          {/* Watch/Unwatch toggle */}
          <button
            onClick={() => void handleWatchToggle()}
            disabled={watchLoading}
            aria-label={isWatching ? "Unwatch market" : "Watch market"}
            title={isWatching ? "Unwatch" : "Watch"}
            className="p-1.5 rounded-lg hover:bg-[#EDE8E0]/60 transition-colors disabled:opacity-50"
          >
            {isWatching ? (
              /* Eye icon — filled gold when watching */
              <svg className="w-5 h-5 text-[#B8860B]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
            ) : (
              /* Eye-off icon — gold outline when not watching */
              <svg className="w-5 h-5 text-[#B8860B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4 animate-fade-in">

        {/* Market question */}
        <div className="rounded-2xl bg-white/80 backdrop-blur-sm border border-[rgba(184,134,11,0.08)] px-6 py-5 shadow-[0_2px_16px_rgba(139,109,71,0.06)]">
          <h1 className="font-serif text-xl font-semibold text-[#2C2C2C] leading-snug mb-3">
            {market.question}
          </h1>
          <MarketTags market={market} className="mb-4" />
          <div className="flex items-center gap-4 text-xs text-[#8B7355]/60 font-sans flex-wrap">
            {openedAt && <span>Opened {timeSince(openedAt)}</span>}
            <span>{formatVolume(market.totalVolume)} volume</span>
            <span className="font-medium text-[#8B7355]">
              Pool: ${(market.totalPool ?? market.totalVolume).toFixed(2)}
            </span>
            <span>{market.outcomes.length} outcomes</span>
            <span>
              {market.uniqueBettorCount ?? 0} bettor{(market.uniqueBettorCount ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Outcomes with live prices */}
        <div className="rounded-2xl bg-white/80 backdrop-blur-sm border border-[rgba(184,134,11,0.08)] px-6 py-5 shadow-[0_2px_16px_rgba(139,109,71,0.06)]">
          <h2 className="font-serif text-xs font-medium text-[#B8860B]/70 uppercase tracking-[0.2em] mb-4">
            Current Odds
          </h2>

          {/* Thin-pool nudge: any outcome with est. payout < 90¢/share on active markets */}
          {isActive && market.outcomes.some(
            (o: { estimatedPayoutPerShare?: number }) =>
              (o.estimatedPayoutPerShare ?? 1) < 0.9
          ) && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2 mb-4">
              <svg
                className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-px"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-xs text-amber-700 leading-snug">
                More bets = bigger payouts for everyone. Spread the word.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {market.outcomes.map((outcome, i) => {
              const livePrice = livePrices[outcome.id];
              const displayPriceCents =
                livePrice !== undefined ? livePrice : outcome.priceCents;
              const colors = outcomeColor(i);
              const history = priceHistory[outcome.id] ?? [];
              const isWinner = outcome.isWinner === true || outcome.id === winningOutcomeId;
              const sharesRemaining = Number(outcome.sharesRemaining ?? Math.max(0, 100 - Number(outcome.sharesSold ?? 0)));
              const maxShares = Number(outcome.maxShares ?? 100);
              const estPayoutCents = Math.round((outcome.estimatedPayoutPerShare ?? 0) * 100);

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
                  {/* Price + est. payout */}
                  <p className="text-[11px] text-warmGray pl-0.5">
                    <span className="font-semibold text-charcoal tabular-nums">
                      {displayPriceCents}¢
                    </span>
                    {estPayoutCents > 0 && (
                      <>
                        {" | "}
                        <span className="text-[#8a6d30] font-medium">
                          est. payout: {estPayoutCents}¢/share
                        </span>
                      </>
                    )}
                    {(() => {
                      const myPos = myOutcomeShares[outcome.id];
                      if (!myPos || myPos.shares <= 0) return null;
                      const pct = myPos.outcomeSharesSold > 0
                        ? ((myPos.shares / myPos.outcomeSharesSold) * 100).toFixed(1)
                        : null;
                      if (!pct) return null;
                      return (
                        <>
                          {" | "}
                          <span className="text-[#8a6d30] font-semibold">
                            your share: {pct}%
                          </span>
                        </>
                      );
                    })()}
                  </p>
                  {/* Shares availability */}
                  <p className="text-[11px] text-warmGray pl-0.5">
                    <span className="font-semibold text-charcoal tabular-nums">
                      {sharesRemaining.toFixed(1)}
                    </span>
                    /{maxShares} shares remaining
                  </p>
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

        {/* Price history chart */}
        <div className="rounded-2xl bg-white/80 backdrop-blur-sm border border-[rgba(184,134,11,0.08)] px-6 py-5 shadow-[0_2px_16px_rgba(139,109,71,0.06)]">
          <h2 className="font-serif text-xs font-medium text-[#B8860B]/70 uppercase tracking-[0.2em] mb-4">
            Price History
          </h2>
          <PriceChart
            data={chartData}
            outcomes={market.outcomes.map((o: { id: string; label: string }) => ({
              id: o.id,
              label: o.label,
            }))}
            hours={chartHours}
            onHoursChange={setChartHours}
          />
        </div>

        {/* Pending market banner */}
        {isPending && (
          <div className="rounded-2xl bg-[#FFF8E7] border border-[#B8860B]/15 px-6 py-5 shadow-[0_2px_16px_rgba(139,109,71,0.06)]">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-[#B8860B] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-[#8B7355]">
                  {scheduledAt
                    ? `Betting opens ${scheduledAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                    : "This market hasn\u2019t opened yet"}
                </p>
                <p className="text-xs text-[#8B7355]/70 mt-1">
                  {scheduledAt
                    ? "You\u2019ll be able to place bets once the market goes live. Check back then!"
                    : "The host will open this market soon. Stay tuned!"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Buy form */}
        {isActive && (
          <div className="rounded-2xl bg-white/80 backdrop-blur-sm border border-[rgba(184,134,11,0.08)] px-6 py-5 shadow-[0_2px_16px_rgba(139,109,71,0.06)]">
            <h2 className="font-serif text-xs font-medium text-[#B8860B]/70 uppercase tracking-[0.2em] mb-4">
              Place a Bet
            </h2>
            <BuyForm
              marketId={market.id}
              outcomes={market.outcomes}
              currentB={market.currentB}
              totalPool={market.totalPool ?? market.totalVolume ?? 0}
              remainingCapCents={20000}
              balanceCents={balanceCents}
              onDepositSuccess={refetchBalance}
              onSuccess={handleBuySuccess}
            />
          </div>
        )}

        {/* Resolved banner */}
        {isResolved && winningOutcomeId && (() => {
          const winningOutcome = market.outcomes.find((o) => o.id === winningOutcomeId);
          const totalPool = market.totalPool ?? market.totalVolume ?? 0;
          const totalWinningShares = winningOutcome?.sharesSold ?? 0;
          // Capped parimutuel: min($1.00, pool / winning_shares)
          const rawPPS = totalWinningShares > 0 ? totalPool / totalWinningShares : 0;
          const payoutPerShare = Math.min(1.0, rawPPS);
          const isFullPayout = rawPPS >= 1.0 - 1e-6;
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
                  {isFullPayout ? (
                    <>
                      Winning shares paid{" "}
                      <span className="font-bold">$1.00/share</span>
                      {" "}(pool of{" "}
                      <span className="font-bold">${totalPool.toFixed(2)}</span>{" "}
                      covered all{" "}
                      <span className="font-bold">{totalWinningShares.toFixed(2)} shares</span>).
                    </>
                  ) : (
                    <>
                      Estimated payout:{" "}
                      <span className="font-bold">${payoutPerShare.toFixed(4)}/share</span>
                      {" "}(pool:{" "}
                      <span className="font-bold">${totalPool.toFixed(2)}</span>{" "}
                      split among{" "}
                      <span className="font-bold">{totalWinningShares.toFixed(2)} shares</span>).
                    </>
                  )}
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

        {/* Positions leaderboard */}
        <div className="rounded-2xl bg-white/80 backdrop-blur-sm border border-[rgba(184,134,11,0.08)] px-6 py-5 shadow-[0_2px_16px_rgba(139,109,71,0.06)]">
          <h2 className="font-serif text-xs font-medium text-[#B8860B]/70 uppercase tracking-[0.2em] mb-3">
            Positions
          </h2>
          {positionsLoading && !positionsData ? (
            <p className="text-xs text-warmGray">Loading positions…</p>
          ) : !positionsData || positionsData.positions.length === 0 ? (
            <p className="text-xs text-warmGray">No positions yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Outcome volume summary */}
              <div className="flex flex-wrap gap-3 mb-1 pb-3 border-b border-[rgba(184,134,11,0.1)]">
                {(market.outcomes as Array<{ id: string; label: string }>).map((o, idx) => {
                  const colors = outcomeColor(idx);
                  const vol = positionsData.outcomeVolumes[o.id];
                  return (
                    <div key={o.id} className="flex items-center gap-1.5">
                      <span
                        className={`text-xs font-semibold rounded-full px-2 py-0.5 ${colors.light} ${colors.text}`}
                      >
                        {o.label}
                      </span>
                      <span className="text-xs font-medium text-charcoal tabular-nums">
                        ${vol ? vol.totalBet.toFixed(0) : "0"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {[...positionsData.positions]
                .sort((a, b) => b.totalDeployed - a.totalDeployed)
                .map((pos, rank) => {
                  const outcomeIdx = market.outcomes.findIndex(
                    (o: { id: string }) => o.id === pos.dominantOutcomeId
                  );
                  const colors = outcomeColor(outcomeIdx >= 0 ? outcomeIdx : 0);

                  // Current value: sum shares * currentPrice (priceCents / 100)
                  let currentValue = 0;
                  for (const [outcomeId, { shares }] of Object.entries(
                    pos.netSharesByOutcome
                  )) {
                    const livePriceCents = livePrices[outcomeId];
                    const priceCents =
                      livePriceCents !== undefined
                        ? livePriceCents
                        : (market.outcomes.find(
                            (o: { id: string }) => o.id === outcomeId
                          )?.priceCents ?? 0);
                    currentValue += shares * (priceCents / 100);
                  }
                  const pnl = currentValue - pos.costBasis;
                  const pnlPositive = pnl >= 0;

                  // Avatar: up to 2 initials from name
                  const initials = (pos.userName ?? "?")
                    .split(" ")
                    .map((w: string) => w[0] ?? "")
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  const volumePct =
                    positionsData.totalVolume > 0
                      ? Math.max(
                          2,
                          (pos.totalDeployed / positionsData.totalVolume) * 100
                        )
                      : 2;

                  return (
                    <div key={pos.userId}>
                      <div className="flex items-center gap-2.5">
                        {/* Rank */}
                        <span className="text-xs text-warmGray w-4 text-center shrink-0">
                          {rank + 1}
                        </span>

                        {/* Avatar */}
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${colors.light} ${colors.text}`}
                        >
                          {initials}
                        </div>

                        {/* Name + outcome pills + trade count */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-[#5a3e1b] truncate max-w-[90px]">
                              {pos.userName}
                            </span>
                            {Object.entries(pos.netSharesByOutcome)
                              .filter(([, { shares }]) => shares > 0)
                              .sort(([, a], [, b]) => b.shares - a.shares)
                              .map(([outcomeId, { shares, label }]) => {
                                const oIdx = market.outcomes.findIndex(
                                  (o: { id: string }) => o.id === outcomeId
                                );
                                const oColors = outcomeColor(oIdx >= 0 ? oIdx : 0);
                                return (
                                  <span
                                    key={outcomeId}
                                    className={`text-xs font-semibold rounded-full px-2 py-0.5 ${oColors.light} ${oColors.text}`}
                                  >
                                    {label} {shares.toFixed(1)}
                                  </span>
                                );
                              })}
                            <span className="text-xs text-warmGray">
                              ({pos.tradeCount}{" "}
                              {pos.tradeCount === 1 ? "trade" : "trades"})
                            </span>
                          </div>
                        </div>

                        {/* Right: deployed + P&L */}
                        <div className="text-right shrink-0">
                          <p className="text-xs font-medium text-charcoal tabular-nums">
                            ${pos.totalDeployed.toFixed(2)}
                          </p>
                          <p
                            className={`text-xs tabular-nums ${
                              pnlPositive ? "text-emerald-600" : "text-[#dc2626]"
                            }`}
                          >
                            {pnlPositive ? "+" : ""}${pnl.toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Volume share bar */}
                      <div className="h-1 rounded-full bg-[#EDE8E0] mt-1.5 ml-[2.75rem]">
                        <div
                          className={`h-1 rounded-full ${colors.bar}`}
                          style={{ width: `${volumePct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
