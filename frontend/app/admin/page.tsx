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

  // House credit state
  const [creditAmount, setCreditAmount] = useState("");
  const [crediting, setCrediting] = useState(false);
  const [creditMsg, setCreditMsg] = useState<string | null>(null);

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
        <h1 className="text-xl font-bold text-charcoal">Dashboard</h1>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-sm text-warmGray hover:text-charcoal disabled:opacity-50 min-h-0 min-w-0 h-auto"
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
          accent="text-charcoal"
        />
        <DashboardStat
          label="Total Users"
          value={data ? String(data.totalUsers) : "—"}
          subtext={`${data?.activeMarketCount ?? 0} active markets`}
          accent="text-charcoal"
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
        <h2 className="text-sm font-semibold text-charcoal mb-3">
          Active Market Pools
        </h2>
        {!data || data.marketPools.length === 0 ? (
          <p className="text-sm text-warmGray">No active markets.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[rgba(184,134,11,0.12)] bg-white">
            <table className="min-w-full text-sm">
              <thead className="border-b border-[rgba(184,134,11,0.12)] bg-cream-100">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-warmGray">
                    Market
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-warmGray">
                    b
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-warmGray">
                    Volume
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-warmGray">
                    Pool Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.marketPools.map((m) => (
                  <tr
                    key={m.marketId}
                    className="border-b border-[rgba(184,134,11,0.12)] last:border-0 hover:bg-cream-100"
                  >
                    <td className="px-4 py-2 text-charcoal max-w-xs truncate">
                      {m.question}
                    </td>
                    <td className="px-4 py-2 text-right text-warmGray tabular-nums">
                      {parseFloat(m.b).toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right text-warmGray">
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

      {/* House credit */}
      <section>
        <h2 className="text-sm font-semibold text-charcoal mb-3">
          House Credits
        </h2>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warmGray text-sm">$</span>
            <input
              type="number"
              min="1"
              max="10000"
              step="1"
              placeholder="Amount"
              value={creditAmount}
              onChange={(e) => { setCreditAmount(e.target.value); setCreditMsg(null); }}
              className="w-32 pl-7 pr-3 py-2 border border-[rgba(184,134,11,0.12)] rounded-lg text-sm
                         focus:outline-none focus:border-gold transition text-charcoal bg-white"
            />
          </div>
          <button
            disabled={crediting || !creditAmount || Number(creditAmount) < 1}
            onClick={async () => {
              setCrediting(true);
              setCreditMsg(null);
              try {
                const cents = Math.round(Number(creditAmount) * 100);
                await trpc.admin.creditHouse.mutate({ amountCents: cents });
                setCreditMsg(`Credited $${Number(creditAmount).toFixed(2)} to House`);
                setCreditAmount("");
                void load();
              } catch (err) {
                setCreditMsg(err instanceof Error ? err.message : "Failed");
              } finally {
                setCrediting(false);
              }
            }}
            className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white
                       disabled:opacity-50 hover:bg-[#2a4d7a] transition"
          >
            {crediting ? "Crediting…" : "Add to House"}
          </button>
          {creditMsg && (
            <span className={`text-xs ${creditMsg.startsWith("Credited") ? "text-emerald-600" : "text-red-600"}`}>
              {creditMsg}
            </span>
          )}
        </div>
      </section>

      {/* Quick links */}
      <section>
        <h2 className="text-sm font-semibold text-charcoal mb-3">
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
              className="rounded-md border border-[rgba(184,134,11,0.12)] bg-white px-4 py-2 text-sm text-charcoal hover:bg-cream-100 hover:border-gray-300 transition-colors shadow-sm"
            >
              {link.label} →
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
