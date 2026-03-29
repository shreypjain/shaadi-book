"use client";

/**
 * Admin Dashboard — Task 4.3
 *
 * Shows aggregate stats and per-market parimutuel pool sizes.
 * Quick links to Market Manager, Withdrawal Queue, User Manager.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import DashboardStat from "@/components/admin/DashboardStat";

interface DashboardData {
  totalDeposits: string;
  totalUsers: number;
  activeMarketCount: number;
  totalVolume: string;
  /** Parimutuel pool across all active markets. House exposure = $0 (zero house risk). */
  totalPoolSize: string;
  housePool: string;
  totalUserBalances: string;
  isReconciled: boolean;
  marketPools: Array<{
    marketId: string;
    question: string;
    volume: string;
    /** Parimutuel pool = volume. 100% goes to winners at resolution. */
    poolSize: string;
    b: string;
  }>;
}

function formatUSD(dollars: string | number) {
  const n = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (isNaN(n)) return "$0.00";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.admin.dashboard.query();
      setData(result as DashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
        >
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <DashboardStat
          label="Total Volume"
          value={data ? formatUSD(data.totalVolume) : "—"}
          subtext="all-time purchases"
          accent="text-gray-900"
        />
        <DashboardStat
          label="Total Users"
          value={data ? String(data.totalUsers) : "—"}
          subtext={`${data?.activeMarketCount ?? 0} active markets`}
          accent="text-gray-900"
        />
        <DashboardStat
          label="Active Pool"
          value={data ? formatUSD(data.totalPoolSize) : "—"}
          subtext="parimutuel — house exposure $0"
          accent="text-emerald-600"
        />
      </div>

      {/* Per-market pool table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Active Market Pools
        </h2>
        {!data || data.marketPools.length === 0 ? (
          <p className="text-sm text-gray-400">No active markets.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                    Market
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                    b
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                    Volume
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                    Pool Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.marketPools.map((m) => (
                  <tr
                    key={m.marketId}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2 text-gray-800 max-w-xs truncate">
                      {m.question}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                      {parseFloat(m.b).toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {formatUSD(m.volume)}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-emerald-700 tabular-nums">
                      {formatUSD(m.poolSize)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Quick links */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Quick Links
        </h2>
        <div className="flex flex-wrap gap-3">
          {[
            { href: "/admin/markets",       label: "Market Manager" },
            { href: "/admin/suggestions",   label: "Suggestions" },
            { href: "/admin/withdrawals",   label: "Withdrawal Queue" },
            { href: "/admin/users",         label: "User Manager" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
            >
              {link.label} →
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
