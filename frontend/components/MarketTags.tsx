/**
 * MarketTags.tsx — Renders event tag, family side badge, and custom tag pills.
 *
 * Tag pill style: rounded-full px-2.5 py-0.5 text-xs font-medium
 *
 * Event colors:
 *   Sangeet          → purple-100 / purple-700
 *   Haldi            → yellow-100 / yellow-700
 *   Baraat           → red-100    / red-700
 *   Wedding Ceremony → pink-100   / pink-700
 *   Reception        → blue-100   / blue-700
 *   After Party      → emerald-100/ emerald-700
 *   General          → gray-100   / gray-700
 *
 * Family side colors:
 *   Spoorthi         → rose-100   / rose-700
 *   Parsh            → sky-100    / sky-700
 *   Both             → amber-100  / amber-700
 */

import type { MarketWithPrices } from "@/lib/api-types";

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const EVENT_COLORS: Record<string, { bg: string; text: string }> = {
  Sangeet: { bg: "bg-purple-100", text: "text-purple-700" },
  Haldi: { bg: "bg-yellow-100", text: "text-yellow-700" },
  Baraat: { bg: "bg-red-100", text: "text-red-700" },
  "Wedding Ceremony": { bg: "bg-pink-100", text: "text-pink-700" },
  Reception: { bg: "bg-blue-100", text: "text-blue-700" },
  "After Party": { bg: "bg-emerald-100", text: "text-emerald-700" },
  General: { bg: "bg-gray-100", text: "text-gray-700" },
};

const FAMILY_COLORS: Record<string, { bg: string; text: string }> = {
  Spoorthi: { bg: "bg-rose-100", text: "text-rose-700" },
  Parsh: { bg: "bg-sky-100", text: "text-sky-700" },
  Both: { bg: "bg-amber-100", text: "text-amber-700" },
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${bg} ${text}`}
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
    ? EVENT_COLORS[eventTag] ?? { bg: "bg-gray-100", text: "text-gray-700" }
    : null;

  const familyColors = familySide
    ? FAMILY_COLORS[familySide] ?? { bg: "bg-gray-100", text: "text-gray-700" }
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
            bg="bg-gray-100"
            text="text-gray-600"
          />
        ))}
    </div>
  );
}
