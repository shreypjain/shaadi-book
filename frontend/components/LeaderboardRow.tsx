"use client";

import { type LeaderboardEntry, formatDollars } from "@/lib/api";

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  isCurrentUser?: boolean;
}

const MEDAL: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

const TOP3_STYLE: Record<
  number,
  { bg: string; border: string; text: string }
> = {
  1: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    text: "text-amber-700",
  },
  2: {
    bg: "bg-gray-100",
    border: "border-gray-300",
    text: "text-gray-600",
  },
  3: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-700",
  },
};

/**
 * A single row in the leaderboard table.
 * Top-3 entries get medal icons and highlighted backgrounds.
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
      className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition-all
        ${isTop3 ? `${style.bg} ${style.border}` : "bg-white border-gray-100"}
        ${isCurrentUser ? "ring-2 ring-brand-400 ring-offset-1" : ""}
      `}
    >
      {/* Rank / medal */}
      <div className="w-8 flex-shrink-0 text-center">
        {isTop3 ? (
          <span className="text-xl">{MEDAL[entry.rank]}</span>
        ) : (
          <span className="text-sm font-bold text-gray-400">
            {entry.rank}
          </span>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p
          className={`font-semibold truncate text-sm
            ${isTop3 ? style.text : "text-gray-800"}
            ${isCurrentUser ? "text-brand-700" : ""}
          `}
        >
          {entry.name}
          {isCurrentUser && (
            <span className="ml-1.5 text-[10px] font-bold bg-brand-100 text-brand-600 px-1.5 py-0.5 rounded-full">
              YOU
            </span>
          )}
        </p>
      </div>

      {/* P&L */}
      <div className="text-right flex-shrink-0">
        <p
          className={`font-bold text-sm tabular-nums
            ${isPositive ? "text-green-600" : "text-red-500"}
          `}
        >
          {isPositive ? "+" : ""}
          {formatDollars(entry.realizedPnlCents)}
        </p>
        <p className="text-[10px] text-gray-400">P&amp;L</p>
      </div>
    </div>
  );
}
