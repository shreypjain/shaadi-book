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
          <div className="h-12 w-40 bg-[#e8e4df] rounded-xl mx-auto" />
          <div className="h-4 w-24 bg-[#f0ece7] rounded mt-2 mx-auto" />
        </div>
      ) : (
        <>
          <p className="text-xs font-medium text-[#8a8a9a] uppercase tracking-widest mb-1">
            Available Balance
          </p>
          <p className="text-5xl font-bold text-[#1e3a5f] tabular-nums">
            {formatDollars(balanceCents)}
          </p>
          {country === "IN" && (
            <p className="text-sm text-[#8a8a9a] mt-1">
              {formatRupees(balanceCents)}{" "}
              <span className="text-[#c8c8d0]">· ₹93 ≈ $1</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
