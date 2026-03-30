"use client";

/**
 * My Suggestions — /suggestions
 *
 * Shows all market suggestions submitted by the logged-in user.
 * Includes status badges (pending / approved / rejected) and admin notes.
 * Also shows a "Suggest a Market" button to open the suggestion modal.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { MarketSuggestionItem } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { SuggestMarketModal } from "@/components/SuggestMarketModal";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  PENDING: {
    label: "Pending review",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-400",
  },
  APPROVED: {
    label: "Approved",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  REJECTED: {
    label: "Not approved",
    bg: "bg-cream-100",
    text: "text-warmGray",
    border: "border-[rgba(184,134,11,0.12)]",
    dot: "bg-[#c8c8d0]",
  },
} as const;

function StatusBadge({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Suggestion card
// ---------------------------------------------------------------------------

function SuggestionCard({ suggestion }: { suggestion: MarketSuggestionItem }) {
  const outcomes = suggestion.outcomes as string[];
  const createdAt = new Date(suggestion.createdAt);
  const timeAgo = getTimeAgo(createdAt);

  return (
    <div className="rounded-xl border border-[rgba(184,134,11,0.12)] bg-ivory-card shadow-sm p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-charcoal leading-snug flex-1">
          {suggestion.questionText}
        </p>
        <StatusBadge status={suggestion.status} />
      </div>

      {/* Outcomes */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {outcomes.map((outcome, i) => (
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
        <p className="text-xs text-warmGray mb-3 italic">{suggestion.description}</p>
      )}

      {/* Admin notes */}
      {suggestion.adminNotes && (
        <div className="rounded-lg border border-[rgba(184,134,11,0.12)] bg-cream-100 px-3 py-2 mb-3">
          <p className="text-xs font-semibold text-warmGray mb-0.5">Admin note</p>
          <p className="text-xs text-warmGray">{suggestion.adminNotes}</p>
        </div>
      )}

      {/* Footer */}
      <p className="text-xs text-[#c0bbb5]">Submitted {timeAgo}</p>
    </div>
  );
}

function getTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MySuggestionsPage() {
  const [suggestions, setSuggestions] = useState<MarketSuggestionItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [showModal, setShowModal] = useState(false);

  const user = typeof window !== "undefined" ? getStoredUser() : null;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.suggest.myList();
      setSuggestions(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load suggestions"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [load, user]);

  // Reload after new suggestion submitted
  function handleModalClose() {
    setShowModal(false);
    void load();
  }

  if (!user) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        <div className="rounded-xl border border-[rgba(184,134,11,0.12)] bg-ivory-card p-8 text-center">
          <p className="text-sm text-warmGray">
            Please log in to see your suggestions.
          </p>
        </div>
      </main>
    );
  }

  const pending = suggestions?.filter((s) => s.status === "PENDING") ?? [];
  const approved = suggestions?.filter((s) => s.status === "APPROVED") ?? [];
  const rejected = suggestions?.filter((s) => s.status === "REJECTED") ?? [];

  return (
    <>
      <SuggestMarketModal isOpen={showModal} onClose={handleModalClose} />

      <div className="min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-cream-100/95 backdrop-blur border-b border-[rgba(184,134,11,0.12)] px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-charcoal tracking-tight">My Suggestions</h1>
              <p className="text-xs text-warmGray">Market ideas you've submitted</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gold bg-gold-pale px-3 py-1.5 text-xs font-semibold text-[#8a6d30] hover:bg-[#f5f0e0] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New idea
            </button>
          </div>
        </header>

        <main className="max-w-lg mx-auto px-4 py-4 pb-24">
          {/* Loading skeleton */}
          {isLoading && (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="rounded-xl border border-[rgba(184,134,11,0.12)] bg-ivory-card p-5 animate-pulse">
                  <div className="flex items-start justify-between mb-3">
                    <div className="h-4 bg-gold-light rounded w-2/3" />
                    <div className="h-5 bg-gold-light rounded-full w-20" />
                  </div>
                  <div className="flex gap-2 mb-3">
                    <div className="h-5 bg-gold-light rounded-full w-12" />
                    <div className="h-5 bg-gold-light rounded-full w-10" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {error && !isLoading && (
            <div className="rounded-xl border border-[#dc2626]/20 bg-red-50 p-6 text-center">
              <p className="text-sm text-[#dc2626] font-medium mb-3">
                Couldn&apos;t load suggestions
              </p>
              <button
                onClick={() => void load()}
                className="text-sm font-semibold text-[#dc2626] underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && suggestions?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-16 h-16 rounded-full bg-gold-pale flex items-center justify-center">
                <svg className="w-8 h-8 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-charcoal">No suggestions yet</p>
                <p className="text-sm text-warmGray mt-1 max-w-xs">
                  Have an idea for a fun prediction market? Share it with the admins!
                </p>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="rounded-xl bg-gold text-white font-semibold text-sm px-5 py-2.5 hover:bg-gold-600 transition-colors"
              >
                Suggest a market
              </button>
            </div>
          )}

          {/* Suggestion lists */}
          {!isLoading && !error && suggestions && suggestions.length > 0 && (
            <div className="flex flex-col gap-6">
              {/* Pending */}
              {pending.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 px-1 mb-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span className="text-xs font-semibold text-warmGray uppercase tracking-wider">
                      Pending review ({pending.length})
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {pending.map((s) => (
                      <SuggestionCard key={s.id} suggestion={s} />
                    ))}
                  </div>
                </section>
              )}

              {/* Approved */}
              {approved.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 px-1 mb-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-warmGray uppercase tracking-wider">
                      Approved ({approved.length})
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {approved.map((s) => (
                      <SuggestionCard key={s.id} suggestion={s} />
                    ))}
                  </div>
                </section>
              )}

              {/* Rejected */}
              {rejected.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 px-1 mb-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#c8c8d0]" />
                    <span className="text-xs font-semibold text-warmGray uppercase tracking-wider">
                      Not approved ({rejected.length})
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {rejected.map((s) => (
                      <SuggestionCard key={s.id} suggestion={s} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
