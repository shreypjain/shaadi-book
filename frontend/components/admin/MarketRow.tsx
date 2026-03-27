"use client";

/**
 * MarketRow — one row in the admin market manager table.
 *
 * Shows status badge + action buttons per status:
 *   ACTIVE   → Resolve, Pause, Void
 *   PAUSED   → Void
 *   PENDING  → Void
 *   RESOLVED → (read-only)
 *   VOIDED   → (read-only)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

type MarketStatus = "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED";

export interface MarketRowData {
  id: string;
  question: string;
  status: string;
  currentB: number;
  totalVolume: number;
  outcomes: Array<{ id: string; label: string; price: number }>;
  createdAt: Date | string;
  resolvedAt: Date | string | null;
}

interface Props {
  market: MarketRowData;
  onChanged: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:  "bg-yellow-100 text-yellow-800",
  ACTIVE:   "bg-green-100  text-green-800",
  PAUSED:   "bg-orange-100 text-orange-800",
  RESOLVED: "bg-blue-100   text-blue-800",
  VOIDED:   "bg-gray-100   text-gray-600",
};

export default function MarketRow({ market, onChanged }: Props) {
  const status = market.status as MarketStatus;
  const [resolveOutcomeId, setResolveOutcomeId] = useState<string>("");
  const [confirming, setConfirming] = useState<null | "resolve" | "pause" | "void">(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(
    action: "resolve" | "pause" | "void"
  ) {
    if (action === "resolve" && !resolveOutcomeId) {
      setError("Select a winning outcome first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (action === "resolve") {
        await trpc.market.resolve.mutate({
          marketId: market.id,
          winningOutcomeId: resolveOutcomeId,
        });
      } else if (action === "pause") {
        await trpc.market.pause.mutate({ marketId: market.id });
      } else {
        await trpc.market.void.mutate({ marketId: market.id });
      }
      setConfirming(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  const houseExposure =
    market.outcomes.length >= 2
      ? (market.currentB * Math.log(market.outcomes.length)).toFixed(2)
      : "—";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 break-words">
            {market.question}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(market.createdAt).toLocaleString()} ·{" "}
            vol ${market.totalVolume.toFixed(2)} ·{" "}
            b={market.currentB.toFixed(1)} ·{" "}
            exposure ${houseExposure}
          </p>
        </div>
        <span
          className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_COLORS[status] ?? STATUS_COLORS.VOIDED
          }`}
        >
          {status}
        </span>
      </div>

      {/* Outcome prices */}
      <div className="flex flex-wrap gap-2">
        {market.outcomes.map((o) => (
          <span
            key={o.id}
            className="rounded bg-gray-50 border border-gray-200 px-2 py-0.5 text-xs text-gray-600"
          >
            {o.label}: {Math.round(o.price * 100)}¢
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      {/* Actions — only for actionable statuses */}
      {(status === "ACTIVE" || status === "PAUSED" || status === "PENDING") && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {status === "ACTIVE" && (
            <>
              {/* Resolve */}
              {confirming === "resolve" ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <select
                    value={resolveOutcomeId}
                    onChange={(e) => setResolveOutcomeId(e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none"
                  >
                    <option value="">— pick winner —</option>
                    {market.outcomes.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleAction("resolve")}
                    disabled={loading}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                  >
                    {loading ? "…" : "Confirm"}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="text-xs text-gray-500 hover:text-gray-700 min-h-0 min-w-0 h-auto"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming("resolve")}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 min-h-0 min-w-0 h-auto"
                >
                  Resolve
                </button>
              )}

              {/* Pause */}
              {confirming === "pause" ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-600">Pause this market?</span>
                  <button
                    onClick={() => handleAction("pause")}
                    disabled={loading}
                    className="rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                  >
                    {loading ? "…" : "Yes, pause"}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="text-xs text-gray-500 hover:text-gray-700 min-h-0 min-w-0 h-auto"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming("pause")}
                  className="rounded border border-orange-300 px-3 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50 min-h-0 min-w-0 h-auto"
                >
                  Pause
                </button>
              )}
            </>
          )}

          {/* Void — always shown for non-terminal statuses */}
          {confirming === "void" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-600 font-medium">
                Void and refund all bets?
              </span>
              <button
                onClick={() => handleAction("void")}
                disabled={loading}
                className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
              >
                {loading ? "…" : "Yes, void"}
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="text-xs text-gray-500 hover:text-gray-700 min-h-0 min-w-0 h-auto"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming("void")}
              className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 min-h-0 min-w-0 h-auto"
            >
              Void
            </button>
          )}
        </div>
      )}
    </div>
  );
}
