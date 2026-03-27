/**
 * PriceTag.tsx — Formatted price display component.
 * Renders an LMSR outcome price with consistent styling.
 */

import { formatPriceCents } from "@/lib/utils";

interface PriceTagProps {
  /** Price in cents (0–100) */
  priceCents: number;
  size?: "sm" | "md" | "lg";
  highlight?: boolean;
  className?: string;
}

export function PriceTag({
  priceCents,
  size = "md",
  highlight = false,
  className = "",
}: PriceTagProps) {
  const sizeClasses = {
    sm: "text-sm font-semibold",
    md: "text-base font-bold",
    lg: "text-xl font-bold",
  }[size];

  return (
    <span
      className={`tabular-nums ${
        highlight ? "text-brand-700" : "text-gray-800"
      } ${sizeClasses} ${className}`}
    >
      {formatPriceCents(priceCents)}
    </span>
  );
}
