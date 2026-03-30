"use client";

/**
 * Admin Suggestions — /admin/suggestions
 *
 * Admin view: list all market suggestions with approve/reject buttons.
 * Filterable by status (PENDING / APPROVED / REJECTED).
 * Shows submitter name, phone, outcomes, and optional description.
 */

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Suggestion {
  id: string;
  userId: string;
  questionText: string;
  outcomes: string[];
  description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  userName?: string;
  userPhone?: string;
}

type StatusFilter = "ALL" | "PENDING" | "APPROVED" | "REJECTED";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  PENDING: {
    label: "Pending",
    bg: "bg-yellow-100",
    text: "text-yellow-800",
  },
  APPROVED: {
    label: "Approved",
    bg: "bg-green-100",
    text: "text-green-800",
  },
  REJECTED: {
    label: "Rejected",
    bg: "bg-red-100",
    text: "text-red-700",
  },
} as const;

function StatusBadge({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Suggestion row
// ---------------------------------------------------------------------------

interface SuggestionRowProps {
  suggestion: Suggestion;
  onReviewed: () => void;
}

function SuggestionRow({ suggestion, onReviewed }: SuggestionRowProps) {
  const [adminNotes, setAdminNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReview(status: "APPROVED" | "REJECTED") {
    setIsLoading(true);
    setError(null);
    try {
      await trpc.suggest.adminReview.mutate({
        suggestionId: suggestion.id,
        status,
        adminNotes: adminNotes.trim() || undefined,
      });
      onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-[rgba(184,134,11,0.12)] bg-ivory-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-charcoal text-sm leading-snug">
            {suggestion.questionText}
          </p>
          <p className="text-xs text-warmGray mt-0.5">
            by{" "}
            <span className="font-medium text-warmGray">
              {suggestion.userName ?? "Unknown"}
            </span>
            {suggestion.userPhone ? ` · ${suggestion.userPhone}` : ""}
            {" · "}
            {new Date(suggestion.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={suggestion.status} />
      </div>

      {/* Outcomes */}
      <div className="flex flex-wrap gap-1.5">
        {suggestion.outcomes.map((outcome, i) => (
          <span
            key={i}
            className="rounded-full border border-[rgba(184,134,11,0.12)] bg-cream-100 px-2.5 py-0.5 text-xs text-warmGray"
          >
            {outcome}
          </span>
        ))}
      </div>

      {/* Description */}
      {suggestion.description && (
        <p className="text-xs text-warmGray italic bg-cream-100 rounded px-3 py-2">
          {suggestion.description}
        </p>
      )}

      {/* Existing admin notes */}
      {suggestion.adminNotes && (
        <div className="rounded border border-[rgba(184,134,11,0.12)] bg-cream-100 px-3 py-2">
          <p className="text-xs font-semibold text-warmGray mb-0.5">Admin note</p>
          <p className="text-xs text-warmGray">{suggestion.adminNotes}</p>
        </div>
      )}

      {/* Actions for PENDING suggestions */}
      {suggestion.status === "PENDING" && (
        <div className="space-y-2 pt-1">
          {/* Notes toggle */}
          {!showNotes ? (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-xs text-warmGray hover:text-charcoal underline min-h-0 min-w-0 h-auto"
            >
              + Add a note (optional)
            </button>
          ) : (
            <div>
              <textarea
                rows={2}
                maxLength={500}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Optional note for the guest…"
                className="w-full rounded border border-[rgba(184,134,11,0.12)] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-gold/30 resize-none"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleReview("APPROVED")}
              disabled={isLoading}
              className="rounded bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors min-h-0 min-w-0 h-auto"
            >
              {isLoading ? "…" : "Approve"}
            </button>
            <button
              onClick={() => void handleReview("REJECTED")}
              disabled={isLoading}
              className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors min-h-0 min-w-0 h-auto"
            >
              {isLoading ? "…" : "Reject"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminSuggestionsPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await trpc.suggest.adminList.query(
        statusFilter === "ALL" ? {} : { status: statusFilter }
      );
      setSuggestions(data as Suggestion[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = suggestions?.filter((s) => s.status === "PENDING").length ?? 0;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-charcoal">Market Suggestions</h1>
          <p className="text-sm text-warmGray mt-0.5">
            Review guest-submitted market ideas
            {pendingCount > 0 && (
              <span className="ml-2 inline-block rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5">
                {pendingCount} pending
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={isLoading}
          className="text-sm text-warmGray hover:text-charcoal disabled:opacity-50 min-h-0 min-w-0 h-auto"
        >
          {isLoading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-[rgba(184,134,11,0.12)]">
        {(["PENDING", "APPROVED", "REJECTED", "ALL"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              statusFilter === f
                ? "border-gold text-charcoal"
                : "border-transparent text-warmGray hover:text-charcoal"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="rounded-lg border border-[rgba(184,134,11,0.12)] bg-ivory-card p-4 animate-pulse">
              <div className="h-4 bg-gold-light rounded w-2/3 mb-3" />
              <div className="flex gap-2">
                <div className="h-5 bg-gold-light rounded-full w-12" />
                <div className="h-5 bg-gold-light rounded-full w-10" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && suggestions?.length === 0 && (
        <div className="text-center py-12">
          <p className="text-warmGray text-sm">No {statusFilter === "ALL" ? "" : statusFilter.toLowerCase() + " "}suggestions.</p>
        </div>
      )}

      {/* Suggestions */}
      {!isLoading && suggestions && suggestions.length > 0 && (
        <div className="space-y-4">
          {suggestions.map((s) => (
            <SuggestionRow key={s.id} suggestion={s} onReviewed={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}
