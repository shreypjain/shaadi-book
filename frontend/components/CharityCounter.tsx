"use client";

import { formatDollars } from "@/lib/api";

interface CharityCounterProps {
  /**
   * Net charity amount in cents after Stripe processing fees have been
   * deducted from the gross 20% pool.
   * net = gross_charity_fees − stripe_processing_fees
   */
  totalCents: number;
  loading?: boolean;
}

/**
 * Charity Impact counter displayed at the top of the leaderboard.
 * Shows the net donation amount: 20% of all winnings minus Stripe fees.
 *
 * PRD §10 — "A separate 'Charity Impact' counter shows total fees collected"
 * PRD §7.5 — Charity fee = 20% of gross payout; Stripe fees absorbed from pool
 */
export function CharityCounter({ totalCents, loading = false }: CharityCounterProps) {
  return (
    <div className="rounded-xl bg-white border border-[rgba(184,134,11,0.12)] shadow-card p-4">
      <div className="flex items-center gap-4">
        {/* Gold heart icon */}
        <div className="w-10 h-10 rounded-full bg-[#f5efd9] flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-[#c8a45c]" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
          </svg>
        </div>

        <div className="flex-1">
          <p className="text-xs font-semibold text-warmGray uppercase tracking-wider">
            Charity Impact
          </p>
          {loading ? (
            <div className="h-7 w-24 bg-[#e8e4df] rounded-lg animate-pulse mt-1" />
          ) : (
            <p className="text-2xl font-bold text-charcoal tabular-nums">
              {formatDollars(totalCents)}
            </p>
          )}
          <p className="text-xs text-warmGray mt-0.5">
            donated from 20% of winnings (net of processing fees)
          </p>
        </div>

        {/* Gold accent bar */}
        <div className="w-1 self-stretch rounded-full bg-[#c8a45c] opacity-60" />
      </div>
    </div>
  );
}
