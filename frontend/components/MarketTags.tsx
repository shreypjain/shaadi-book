/**
 * MarketTags.tsx — Renders event tag, family side badge, and custom tag pills.
 *
 * Redesigned: unified warm-gray outlined pills, no bright colored backgrounds.
 * All tags share the same neutral style: thin 1px border, charcoal text.
 */

import type { MarketWithPrices } from "@/lib/api-types";

// ---------------------------------------------------------------------------
// Pill primitive — unified neutral style
// ---------------------------------------------------------------------------

function Pill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[#D4C5A9]/30 px-2 py-0.5 text-[10px] font-sans font-medium tracking-wide uppercase text-[#8B7355] bg-[#FAF7F2]">
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MarketTags
// ---------------------------------------------------------------------------

interface MarketTagsProps {
  market: Pick<MarketWithPrices, "eventTag" | "familySide" | "customTags">;
  /** Additional class name for the wrapping div */
  className?: string;
}

export function MarketTags({ market, className = "" }: MarketTagsProps) {
  const { eventTag, familySide, customTags } = market;
  const hasAny = eventTag || familySide || (customTags && customTags.length > 0);

  if (!hasAny) return null;

  const familyLabel =
    familySide === "Spoorthi"
      ? "Spoorthi's side"
      : familySide === "Parsh"
      ? "Parsh's side"
      : familySide === "Both"
      ? "Both sides"
      : null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {eventTag && <Pill label={eventTag} />}
      {familyLabel && <Pill label={familyLabel} />}
      {customTags &&
        customTags.map((tag) => (
          <Pill key={tag} label={tag} />
        ))}
    </div>
  );
}
