"use client";

import { type LeaderboardEntry, formatDollars } from "@/lib/api";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser?: boolean;
}

// Top-3 rank badge styles: gold, silver, bronze
const TOP3_STYLE: Record<number, { bg: string; border: string; text: string; rankBg: string; rankText: string }> = {
  1: {
    bg: "bg-[#f5efd9]",
    border: "border-[#c8a45c]/40",
    text: "text-[#8a6d30]",
    rankBg: "bg-[#c8a45c]",
    rankText: "text-white",
  },
  2: {
    bg: "bg-[#f4f4f6]",
    border: "border-[#c8c8d0]/40",
    text: "text-warmGray",
    rankBg: "bg-[#9ca3af]",
    rankText: "text-white",
  },
  3: {
    bg: "bg-[#fdf0e6]",
    border: "border-[#d97706]/30",
    text: "text-[#92400e]",
    rankBg: "bg-[#d97706]",
    rankText: "text-white",
  },
};

/**
 * A single row in the leaderboard table.
 * Top-3 entries get gold/silver/bronze accents.
 *
 * PRD §10 — Leaderboard
 */
export function LeaderboardRow({
  entry,
  isCurrentUser = false,
}: LeaderboardRowProps) {
  const isTop3 = entry.rank <= 3;
  const style = TOP3_STYLE[entry.rank];
  const isPositive = entry.realizedPnlCents >= 0;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all
        ${isTop3 ? `${style.bg} ${style.border}` : "bg-white border-[rgba(184,134,11,0.12)]"}
        ${isCurrentUser ? "ring-2 ring-[#1e3a5f]/20 ring-offset-1" : ""}
      `}
    >
      {/* Rank badge */}
      <div className="w-8 flex-shrink-0 text-center">
        {isTop3 ? (
          <span
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold
              ${style.rankBg} ${style.rankText}`}
          >
            {entry.rank}
          </span>
        ) : (
          <span className="text-sm font-bold text-warmGray">
            {entry.rank}
          </span>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p
          className={`font-semibold truncate text-sm
            ${isTop3 ? style.text : "text-charcoal"}
            ${isCurrentUser ? "text-[#1e3a5f]" : ""}
          `}
        >
          {entry.name}
          {isCurrentUser && (
            <span className="ml-1.5 text-[10px] font-bold bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded-full">
              YOU
            </span>
          )}
        </p>
      </div>

      {/* P&L */}
      <div className="text-right flex-shrink-0">
        <p
          className={`font-bold text-sm tabular-nums
            ${isPositive ? "text-emerald-600" : "text-[#dc2626]"}
          `}
        >
          {isPositive ? "+" : ""}
          {formatDollars(entry.realizedPnlCents)}
        </p>
        <p className="text-[10px] text-warmGray">P&amp;L</p>
      </div>
    </div>
  );
}
