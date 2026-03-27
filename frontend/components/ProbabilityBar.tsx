/**
 * ProbabilityBar.tsx — Colored outcome probability bar.
 * Width = price% of container. Used on market cards and detail pages.
 */

import { cn } from "@/lib/utils";

interface ProbabilityBarProps {
  /** Outcome label, e.g. "Yes" */
  label: string;
  /** Price in cents (0–100) */
  priceCents: number;
  /** Tailwind bg class for the filled bar, e.g. "bg-rose-400" */
  barColor: string;
  /** Tailwind text class for label, e.g. "text-rose-700" */
  textColor: string;
  /** Tailwind bg class for track, e.g. "bg-rose-50" */
  trackColor: string;
  isWinner?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function ProbabilityBar({
  label,
  priceCents,
  barColor,
  textColor,
  trackColor,
  isWinner = false,
  size = "md",
  className = "",
}: ProbabilityBarProps) {
  const clampedPct = Math.max(2, Math.min(98, priceCents)); // never fully empty or full visually
  const barHeight = size === "sm" ? "h-2" : "h-3";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between">
        <span className={cn(textSize, "font-medium text-gray-700 flex items-center gap-1")}>
          {isWinner && (
            <span className="text-amber-500 text-xs">✓</span>
          )}
          {label}
        </span>
        <span className={cn(textSize, "font-bold tabular-nums", textColor)}>
          {Math.round(priceCents)}¢
        </span>
      </div>
      <div className={cn("w-full rounded-full overflow-hidden", barHeight, trackColor)}>
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            barColor,
            isWinner && "ring-1 ring-amber-400"
          )}
          style={{ width: `${clampedPct}%` }}
          role="progressbar"
          aria-valuenow={priceCents}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${Math.round(priceCents)}¢`}
        />
      </div>
    </div>
  );
}
