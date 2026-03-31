"use client";

/**
 * MarketRow — one row in the admin market manager table.
 *
 * Shows status badge + action buttons per status:
 *   ACTIVE   → Resolve, Pause, Void
 *   PAUSED   → Resume, Void
 *   PENDING  → Void
 *   RESOLVED → (read-only)
 *   VOIDED   → (read-only)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { api } from "@/lib/api";

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
  uniqueBettorCount?: number;
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
  VOIDED:   "bg-gold-light   text-warmGray",
};

export default function MarketRow({ market, onChanged }: Props) {
  const status = market.status as MarketStatus;
  const [resolveOutcomeId, setResolveOutcomeId] = useState<string>("");
  const [resolveCustomTime, setResolveCustomTime] = useState<string>("");
  const [confirming, setConfirming] = useState<null | "resolve" | "pause" | "resume" | "void" | "voidAfter">(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Void-late-trades state
  const [voidAfterCutoff, setVoidAfterCutoff] = useState<string>("");
  const [voidAfterPreviewCount, setVoidAfterPreviewCount] = useState<number | null>(null);
  const [voidAfterResult, setVoidAfterResult] = useState<{ voidedCount: number; totalRefunded: number } | null>(null);

  async function handleAction(
    action: "resolve" | "pause" | "resume" | "void"
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
          ...(resolveCustomTime ? { resolvedAt: new Date(resolveCustomTime).toISOString() } : {}),
        });
      } else if (action === "pause") {
        await trpc.market.pause.mutate({ marketId: market.id });
      } else if (action === "resume") {
        await trpc.market.resume.mutate({ marketId: market.id });
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

  async function handleVoidAfter() {
    if (!voidAfterCutoff) {
      setError("Select a cutoff date/time first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.market.voidTradesAfter({
        marketId: market.id,
        cutoffTime: new Date(voidAfterCutoff).toISOString(),
      });
      setVoidAfterResult(result);
      setConfirming(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Void failed");
    } finally {
      setLoading(false);
    }
  }

  const houseExposure =
    market.outcomes.length >= 2
      ? (market.currentB * Math.log(market.outcomes.length)).toFixed(2)
      : "—";

  const bettorCount = market.uniqueBettorCount ?? 0;
  const MIN_BETTORS = 5;

  return (
    <div className="rounded-lg border border-[rgba(184,134,11,0.12)] bg-white p-4 space-y-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-charcoal break-words">
            {market.question}
          </p>
          <p className="text-xs text-warmGray mt-0.5">
            {new Date(market.createdAt).toLocaleString()} ·{" "}
            vol ${market.totalVolume.toFixed(2)} ·{" "}
            b={market.currentB.toFixed(1)} ·{" "}
            exposure ${houseExposure} ·{" "}
            <span className={bettorCount < MIN_BETTORS && status === "ACTIVE" ? "text-amber-600 font-medium" : ""}>
              {bettorCount}/{MIN_BETTORS} bettors
              {bettorCount < MIN_BETTORS && status === "ACTIVE" ? " ⚠ (min needed to resolve)" : ""}
            </span>
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
            className="rounded bg-cream-100 border border-[rgba(184,134,11,0.12)] px-2 py-0.5 text-xs text-warmGray"
          >
            {o.label}: {Math.round(o.price * 100)}¢
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      {/* Void-after success */}
      {voidAfterResult && (
        <p className="text-xs text-amber-700">
          Voided {voidAfterResult.voidedCount} trade{voidAfterResult.voidedCount !== 1 ? "s" : ""} · refunded ${voidAfterResult.totalRefunded.toFixed(2)}
        </p>
      )}

      {/* Actions — only for actionable statuses */}
      {(status === "ACTIVE" || status === "PAUSED" || status === "PENDING") && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {status === "ACTIVE" && (
            <>
              {/* Resolve */}
              {confirming === "resolve" ? (
                <div className="flex flex-col gap-1.5">
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
                      className="text-xs text-warmGray hover:text-charcoal min-h-0 min-w-0 h-auto"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <label className="text-[10px] text-warmGray">
                      Resolution time (optional, defaults to now):
                    </label>
                    <input
                      type="datetime-local"
                      value={resolveCustomTime}
                      onChange={(e) => setResolveCustomTime(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none"
                    />
                  </div>
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
                  <span className="text-xs text-warmGray">Pause this market?</span>
                  <button
                    onClick={() => handleAction("pause")}
                    disabled={loading}
                    className="rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                  >
                    {loading ? "…" : "Yes, pause"}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="text-xs text-warmGray hover:text-charcoal min-h-0 min-w-0 h-auto"
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

          {/* Resume — only for PAUSED markets */}
          {status === "PAUSED" && (
            <>
              {confirming === "resume" ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-warmGray">Resume trading?</span>
                  <button
                    onClick={() => handleAction("resume")}
                    disabled={loading}
                    className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                  >
                    {loading ? "…" : "Yes, resume"}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="text-xs text-warmGray hover:text-charcoal min-h-0 min-w-0 h-auto"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming("resume")}
                  className="rounded border border-green-300 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50 min-h-0 min-w-0 h-auto"
                >
                  Resume
                </button>
              )}
            </>
          )}

          {/* Void late trades — only for ACTIVE markets */}
          {status === "ACTIVE" && (
            <>
              {confirming === "voidAfter" ? (
                <div className="flex flex-col gap-1.5 w-full">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <label className="text-xs text-warmGray">
                      Void all trades after:
                    </label>
                    <input
                      type="datetime-local"
                      value={voidAfterCutoff}
                      onChange={(e) => {
                        setVoidAfterCutoff(e.target.value);
                        setVoidAfterPreviewCount(null);
                      }}
                      className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={handleVoidAfter}
                      disabled={loading || !voidAfterCutoff}
                      className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                    >
                      {loading ? "…" : "Confirm void"}
                    </button>
                    <button
                      onClick={() => { setConfirming(null); setVoidAfterCutoff(""); setVoidAfterPreviewCount(null); }}
                      className="text-xs text-warmGray hover:text-charcoal min-h-0 min-w-0 h-auto"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming("voidAfter")}
                  className="rounded border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 min-h-0 min-w-0 h-auto"
                >
                  Void late trades
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
                className="text-xs text-warmGray hover:text-charcoal min-h-0 min-w-0 h-auto"
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
