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
    <div className="rounded-2xl bg-gradient-to-br from-rose-50 to-amber-50 border-2 border-rose-100 p-4">
      <div className="flex items-center gap-3">
        <div className="text-3xl">💝</div>
        <div className="flex-1">
          <p className="text-xs font-semibold text-rose-500 uppercase tracking-widest">
            Charity Impact
          </p>
          {loading ? (
            <div className="h-7 w-24 bg-rose-100 rounded-lg animate-pulse mt-1" />
          ) : (
            <p className="text-2xl font-bold text-rose-700 tabular-nums">
              {formatDollars(totalCents)}
            </p>
          )}
          <p className="text-xs text-rose-400 mt-0.5">
            donated from 20% of winnings (net of processing fees)
          </p>
        </div>
      </div>
    </div>
  );
}
