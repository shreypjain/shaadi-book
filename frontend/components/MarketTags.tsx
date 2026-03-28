/**
 * MarketTags.tsx — Renders event tag, family side badge, and custom tag pills.
 *
 * Tag pill style: rounded border border-[#e8e4df] px-2 py-0.5 text-[10px] font-medium
 *
 * Event colors (muted pastels):
 *   Sangeet          → #f0ecf5 / #7a5a8a
 *   Haldi            → #f5f0d9 / #7a6830
 *   Baraat           → #f5e8e8 / #8a4a4a
 *   Wedding Ceremony → #f5ebee / #7a4a60
 *   Reception        → #e8edf3 / #3a5a78
 *   After Party      → #e8f0e8 / #3a6848
 *   General          → #faf8f4 / #8a8a9a
 *
 * Family side colors (muted pastels):
 *   Spoorthi         → #f5e8e8 / #8a4a5a
 *   Parsh            → #e8edf3 / #3a5a78
 *   Both             → #f5efd9 / #7a6830
 */

import type { MarketWithPrices } from "@/lib/api-types";

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const EVENT_COLORS: Record<string, { bg: string; text: string }> = {
  Sangeet: { bg: "bg-[#f0ecf5]", text: "text-[#7a5a8a]" },
  Haldi: { bg: "bg-[#f5f0d9]", text: "text-[#7a6830]" },
  Baraat: { bg: "bg-[#f5e8e8]", text: "text-[#8a4a4a]" },
  "Wedding Ceremony": { bg: "bg-[#f5ebee]", text: "text-[#7a4a60]" },
  Reception: { bg: "bg-[#e8edf3]", text: "text-[#3a5a78]" },
  "After Party": { bg: "bg-[#e8f0e8]", text: "text-[#3a6848]" },
  General: { bg: "bg-[#faf8f4]", text: "text-[#8a8a9a]" },
};

const FAMILY_COLORS: Record<string, { bg: string; text: string }> = {
  Spoorthi: { bg: "bg-[#f5e8e8]", text: "text-[#8a4a5a]" },
  Parsh: { bg: "bg-[#e8edf3]", text: "text-[#3a5a78]" },
  Both: { bg: "bg-[#f5efd9]", text: "text-[#7a6830]" },
};

// ---------------------------------------------------------------------------
// Pill primitive
// ---------------------------------------------------------------------------

function Pill({
  label,
  bg,
  text,
}: {
  label: string;
  bg: string;
  text: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border border-[#e8e4df] px-2 py-0.5 text-[10px] font-medium ${bg} ${text}`}
    >
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

  const eventColors = eventTag
    ? EVENT_COLORS[eventTag] ?? { bg: "bg-[#faf8f4]", text: "text-[#8a8a9a]" }
    : null;

  const familyColors = familySide
    ? FAMILY_COLORS[familySide] ?? { bg: "bg-[#faf8f4]", text: "text-[#8a8a9a]" }
    : null;

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
      {eventTag && eventColors && (
        <Pill label={eventTag} bg={eventColors.bg} text={eventColors.text} />
      )}
      {familyLabel && familyColors && (
        <Pill
          label={familyLabel}
          bg={familyColors.bg}
          text={familyColors.text}
        />
      )}
      {customTags &&
        customTags.map((tag) => (
          <Pill
            key={tag}
            label={tag}
            bg="bg-[#faf8f4]"
            text="text-[#8a8a9a]"
          />
        ))}
    </div>
  );
}
