"use client";

/**
 * Admin Dashboard — Task 4.3
 *
 * Shows aggregate stats and per-market house exposure.
 * Quick links to Market Manager, Withdrawal Queue, User Manager.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import DashboardStat from "@/components/admin/DashboardStat";

type DashboardData = Awaited<ReturnType<typeof trpc.admin.dashboard.query>>;

function formatUSD(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
      setData(result);
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
          value={data ? formatUSD(data.totalVolumeCents) : "—"}
          subtext="all-time purchases"
          accent="text-gray-900"
        />
        <DashboardStat
          label="Active Bettors"
          value={data ? String(data.activeUsersCount) : "—"}
          subtext="users with ≥1 bet"
          accent="text-gray-900"
        />
        <DashboardStat
          label="Charity Pool"
          value={data ? formatUSD(data.charityPoolCents) : "—"}
          subtext="20% of resolved payouts"
          accent="text-emerald-600"
        />
        <DashboardStat
          label="House Exposure"
          value={
            data
              ? `$${data.totalHouseExposureDollars.toFixed(2)}`
              : "—"
          }
          subtext="aggregate worst-case loss"
          accent="text-amber-600"
        />
      </div>

      {/* Per-market exposure table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Active Market Exposure
        </h2>
        {!data || data.houseExposure.length === 0 ? (
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
                    Outcomes
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">
                    Max Loss
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.houseExposure.map((m) => (
                  <tr
                    key={m.marketId}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2 text-gray-800 max-w-xs truncate">
                      {m.question}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 tabular-nums">
                      {m.b.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {m.numOutcomes}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-amber-700 tabular-nums">
                      ${m.exposureDollars.toFixed(2)}
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
            { href: "/admin/markets",     label: "Market Manager" },
            { href: "/admin/withdrawals", label: "Withdrawal Queue" },
            { href: "/admin/users",       label: "User Manager" },
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
