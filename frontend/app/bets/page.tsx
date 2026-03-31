"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type PositionItem } from "@/lib/api";
import { PositionCard } from "@/components/PositionCard";
import type { MarketWithPrices } from "@/lib/api-types";

const STATUS_ORDER: PositionItem["marketStatus"][] = [
  "active",
  "pending",
  "paused",
  "resolved",
  "voided",
];

const STATUS_HEADING: Record<PositionItem["marketStatus"], string> = {
  active: "Active",
  pending: "Upcoming",
  paused: "Paused",
  resolved: "Resolved",
  voided: "Voided",
};

export default function BetsPage() {
  const queryClient = useQueryClient();
  const { data: positions, isLoading, error } = useQuery({
    queryKey: ["bets.myPositions"],
    queryFn: () => api.bets.myPositions(),
  });

  // Fetch all markets to filter for watched ones
  const { data: allMarkets } = useQuery({
    queryKey: ["market.list.watchlist"],
    queryFn: () => api.market.list({}),
  });

  // Markets the user is watching but has no position in
  const positionMarketIds = new Set((positions ?? []).map((p) => p.marketId));
  const watchedMarkets: MarketWithPrices[] = (allMarkets ?? []).filter(
    (m: MarketWithPrices) => m.isWatching && !positionMarketIds.has(m.id)
  );

  function handleSellSuccess() {
    void queryClient.invalidateQueries({ queryKey: ["bets.myPositions"] });
  }

  const groups: Partial<Record<PositionItem["marketStatus"], PositionItem[]>> = {};
  // Total cost per market (across all outcomes the user holds)
  const marketTotalCost: Record<string, number> = {};
  if (positions) {
    for (const pos of positions) {
      if (!groups[pos.marketStatus]) groups[pos.marketStatus] = [];
      groups[pos.marketStatus]!.push(pos);
      marketTotalCost[pos.marketId] = (marketTotalCost[pos.marketId] ?? 0) + pos.totalCostCents;
    }
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-ivory/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
        <div className="max-w-lg mx-auto">
          <h1 className="font-serif text-xl font-semibold text-charcoal tracking-[0.05em] uppercase">My Bets</h1>
          {positions && (
            <p className="text-xs text-warmGray mt-0.5">
              {positions.length} position{positions.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-6">

        {/* Watchlist section — watched markets with no open position */}
        {watchedMarkets.length > 0 && (
          <section>
            <h2 className="font-serif text-xs font-medium text-[#B8860B]/70 uppercase tracking-[0.2em] mb-2 px-1 flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-[#B8860B]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
              Watching{" "}
              <span className="font-normal">({watchedMarkets.length})</span>
            </h2>
            <div className="space-y-2">
              {watchedMarkets.map((m) => (
                <Link
                  key={m.id}
                  href={`/markets/${m.id}`}
                  className="flex items-center justify-between rounded-xl border border-[rgba(184,134,11,0.08)] bg-white/80 px-4 py-3 hover:shadow-[0_2px_12px_rgba(139,109,71,0.10)] hover:-translate-y-0.5 transition-all duration-150"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-sm font-semibold text-[#2C2C2C] leading-snug line-clamp-1">
                      {m.question}
                    </p>
                    <p className="text-[11px] text-[#8B7355]/60 mt-0.5 font-sans">
                      {m.outcomes.map((o) => `${o.label} ${o.priceCents}¢`).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                    <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
                      m.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : m.status === "RESOLVED"
                        ? "bg-[#FAF7F2] text-[#8B7355]"
                        : "bg-[#FAF7F2] text-[#8B7355]"
                    }`}>
                      {m.status === "ACTIVE" ? "Live" : m.status === "RESOLVED" ? "Resolved" : m.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-[rgba(184,134,11,0.08)] bg-white/80 backdrop-blur-sm p-4 animate-pulse shadow-[0_2px_16px_rgba(139,109,71,0.06)]"
              >
                <div className="h-4 w-3/4 bg-gold-light rounded mb-3" />
                <div className="h-3 w-1/3 bg-gold-light rounded mb-4" />
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-8 bg-gold-light rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {error != null && (
          <div className="rounded-2xl bg-gold-pale border border-[rgba(184,134,11,0.12)] p-4 text-sm text-warmGray">
            Failed to load bets. Please refresh.
          </div>
        )}

        {!isLoading && !error && (!positions || positions.length === 0) && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-gold-pale flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="font-serif font-semibold text-charcoal">No bets yet</p>
            <p className="text-sm text-warmGray mt-1">
              Head to the Markets tab to place your first bet!
            </p>
          </div>
        )}

        {/* Grouped by status */}
        {STATUS_ORDER.map((status) => {
          const group = groups[status];
          if (!group || group.length === 0) return null;
          return (
            <section key={status}>
              <h2 className="font-serif text-xs font-medium text-[#B8860B]/70 uppercase tracking-[0.2em] mb-2 px-1">
                {STATUS_HEADING[status]}{" "}
                <span className="font-normal">({group.length})</span>
              </h2>
              <div className="space-y-3">
                {group.map((pos) => (
                  <PositionCard
                    key={pos.id}
                    position={pos}
                    onSellSuccess={handleSellSuccess}
                    totalMarketCostCents={marketTotalCost[pos.marketId]}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
