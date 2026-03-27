"use client";

import { formatDollars, formatRupees } from "@/lib/api";

interface BalanceDisplayProps {
  balanceCents: number;
  country?: "US" | "IN";
  loading?: boolean;
}

/**
 * Large, prominent balance display.
 * Shows INR reference rate for Indian guests (PRD §7.6 — display only).
 */
export function BalanceDisplay({
  balanceCents,
  country,
  loading = false,
}: BalanceDisplayProps) {
  return (
    <div className="text-center py-6">
      {loading ? (
        <div className="animate-pulse">
          <div className="h-12 w-40 bg-gray-200 rounded-xl mx-auto" />
          <div className="h-4 w-24 bg-gray-100 rounded mt-2 mx-auto" />
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-widest mb-1">
            Available Balance
          </p>
          <p className="text-5xl font-bold text-brand-700 tabular-nums">
            {formatDollars(balanceCents)}
          </p>
          {country === "IN" && (
            <p className="text-sm text-gray-400 mt-1">
              {formatRupees(balanceCents)}{" "}
              <span className="text-gray-300">· ₹93 ≈ $1</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
