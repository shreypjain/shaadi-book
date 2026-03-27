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

  // Group positions by market status
  const groups: Partial<Record<PositionItem["marketStatus"], PositionItem[]>> =
    {};
  if (positions) {
    for (const pos of positions) {
      if (!groups[pos.marketStatus]) groups[pos.marketStatus] = [];
      groups[pos.marketStatus]!.push(pos);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 pt-12 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">My Bets</h1>
        {positions && (
          <p className="text-sm text-gray-400 mt-0.5">
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
                className="rounded-2xl border-2 border-gray-100 bg-white p-4 animate-pulse"
              >
                <div className="h-4 w-3/4 bg-gray-100 rounded mb-3" />
                <div className="h-3 w-1/3 bg-gray-50 rounded mb-4" />
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-8 bg-gray-50 rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {error != null && (
          <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-sm text-red-600">
            Failed to load bets. Please refresh.
          </div>
        )}

        {!isLoading && !error && (!positions || positions.length === 0) && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🎯</p>
            <p className="font-semibold text-gray-700">No bets yet</p>
            <p className="text-sm text-gray-400 mt-1">
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
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">
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
