"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type PositionItem } from "@/lib/api";
import { PositionCard } from "@/components/PositionCard";

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
  const { data: positions, isLoading, error } = useQuery({
    queryKey: ["bets.myPositions"],
    queryFn: () => api.bets.myPositions(),
  });

  const groups: Partial<Record<PositionItem["marketStatus"], PositionItem[]>> = {};
  if (positions) {
    for (const pos of positions) {
      if (!groups[pos.marketStatus]) groups[pos.marketStatus] = [];
      groups[pos.marketStatus]!.push(pos);
    }
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="bg-white border-b border-[#e8e4df] px-4 pt-12 pb-2">
        <h1 className="text-2xl font-bold text-[#1a1a2e] tracking-tight">My Bets</h1>
        {positions && (
          <p className="text-sm text-[#8a8a9a] mt-0.5">
            {positions.length} position{positions.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4 space-y-6">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-[#e8e4df] bg-white p-4 animate-pulse"
              >
                <div className="h-4 w-3/4 bg-[#e8e4df] rounded mb-3" />
                <div className="h-3 w-1/3 bg-[#f0ece7] rounded mb-4" />
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-8 bg-[#f5f2ed] rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {error != null && (
          <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-[#dc2626]">
            Failed to load bets. Please refresh.
          </div>
        )}

        {!isLoading && !error && (!positions || positions.length === 0) && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-brand-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="font-semibold text-[#1a1a2e]">No bets yet</p>
            <p className="text-sm text-[#8a8a9a] mt-1">
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
              <h2 className="text-xs font-bold text-[#8a8a9a] uppercase tracking-widest mb-2 px-1">
                {STATUS_HEADING[status]}{" "}
                <span className="font-normal">({group.length})</span>
              </h2>
              <div className="space-y-3">
                {group.map((pos) => (
                  <PositionCard key={pos.id} position={pos} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
