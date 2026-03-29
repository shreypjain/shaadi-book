/**
 * ProbabilityBar.tsx — Monochromatic gold outcome probability bar.
 * Width = price% of container. Used on market cards and detail pages.
 *
 * Redesigned: single gold gradient bar on warm-gray track (#EDE8E0).
 * The barColor/textColor/trackColor props are accepted for API compatibility
 * but the visual always uses the palace gold palette.
 */

import { cn } from "@/lib/utils";

interface ProbabilityBarProps {
  /** Outcome label, e.g. "Yes" */
  label: string;
  /** Price in cents (0–100) */
  priceCents: number;
  /** Legacy prop — kept for API compat, ignored visually */
  barColor?: string;
  /** Legacy prop — kept for API compat, ignored visually */
  textColor?: string;
  /** Legacy prop — kept for API compat, ignored visually */
  trackColor?: string;
  isWinner?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function ProbabilityBar({
  label,
  priceCents,
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
        <span className={cn(textSize, "font-medium text-[#2C2C2C] flex items-center gap-1")}>
          {isWinner && (
            <span className="text-[#B8860B] text-xs">✓</span>
          )}
          {label}
        </span>
        <span className={cn(textSize, "font-semibold tabular-nums text-[#B8860B]")}>
          {Math.round(priceCents)}¢
        </span>
      </div>
      {/* Track: warm gray #EDE8E0 */}
      <div className={cn("w-full rounded-full overflow-hidden bg-[#EDE8E0]", barHeight)}>
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            isWinner ? "ring-1 ring-[#B8860B]/40" : ""
          )}
          style={{
            width: `${clampedPct}%`,
            background: "linear-gradient(90deg, #B8860B 0%, #d4a017 100%)",
          }}
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
