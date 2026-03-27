"use client";

/**
 * Admin Market Manager — Task 4.3
 *
 * Create markets and manage the full lifecycle of existing ones.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import CreateMarketForm from "@/components/admin/CreateMarketForm";
import MarketRow, { type MarketRowData } from "@/components/admin/MarketRow";

type MarketStatus = "ALL" | "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED";

export default function AdminMarketsPage() {
  const [markets, setMarkets] = useState<MarketRowData[]>([]);
  const [filter, setFilter] = useState<MarketStatus>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.market.list.query(
        filter === "ALL" ? {} : { status: filter }
      );
      // map to MarketRowData shape
      const rows: MarketRowData[] = result.map((m) => ({
        id: m.id,
        question: m.question,
        status: m.status,
        currentB: m.currentB,
        totalVolume: m.totalVolume,
        outcomes: m.outcomes.map((o) => ({
          id: o.id,
          label: o.label,
          price: o.price,
        })),
        createdAt: m.createdAt,
        resolvedAt: m.resolvedAt,
      }));
      setMarkets(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load markets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  const STATUS_FILTERS: MarketStatus[] = [
    "ALL",
    "ACTIVE",
    "PENDING",
    "PAUSED",
    "RESOLVED",
    "VOIDED",
  ];

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-xl font-bold text-gray-900">Market Manager</h1>

      {/* Create form */}
      <CreateMarketForm onCreated={() => void load()} />

      {/* Filter + list */}
      <section className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-gray-700">All Markets</h2>
          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors min-h-0 min-w-0 h-auto ${
                  filter === s
                    ? "bg-gray-800 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {s}
              </button>
            ))}
            <button
              onClick={() => void load()}
              disabled={loading}
              className="ml-2 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 min-h-0 min-w-0 h-auto"
            >
              {loading ? "…" : "↻"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && markets.length === 0 && (
          <p className="text-sm text-gray-400">No markets found.</p>
        )}

        <div className="space-y-3">
          {markets.map((m) => (
            <MarketRow key={m.id} market={m} onChanged={() => void load()} />
          ))}
        </div>
      </section>
    </div>
  );
}
