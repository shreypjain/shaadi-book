"use client";

/**
 * CreateMarketForm — Task 4.3 + market tags
 *
 * Allows an admin to create a new market with:
 *   - Question text
 *   - 2–5 outcome labels (dynamic add / remove)
 *   - Optional b_floor override
 *   - Open time: immediate or scheduled datetime
 *   - Event tag (Sangeet, Haldi, etc.)
 *   - Family side (Spoorthi / Parsh / Both)
 *   - Custom freeform tags (comma-separated)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { EVENT_TAGS, FAMILY_SIDES, type EventTag, type FamilySide } from "@/lib/api-types";

interface Props {
  onCreated: () => void;
}

const MIN_OUTCOMES = 2;
const MAX_OUTCOMES = 5;

export default function CreateMarketForm({ onCreated }: Props) {
  const [question, setQuestion] = useState("");
  const [outcomes, setOutcomes] = useState<string[]>(["Yes", "No"]);
  const [bFloor, setBFloor] = useState("");
  const [openMode, setOpenMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [eventTag, setEventTag] = useState<EventTag | "">("");
  const [familySide, setFamilySide] = useState<FamilySide | "">("");
  const [customTagsRaw, setCustomTagsRaw] = useState("");
  /** Seed amount per outcome in dollars. 0 = disable. Default $20. */
  const [seedDollars, setSeedDollars] = useState("20");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addOutcome() {
    if (outcomes.length < MAX_OUTCOMES) {
      setOutcomes((prev) => [...prev, ""]);
    }
  }

  function removeOutcome(index: number) {
    if (outcomes.length <= MIN_OUTCOMES) return;
    setOutcomes((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOutcome(index: number, value: string) {
    setOutcomes((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
    if (trimmedOutcomes.length < MIN_OUTCOMES) {
      setError("At least 2 outcome labels are required.");
      return;
    }

    const customTags = customTagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const seedAmountCents = Math.round(parseFloat(seedDollars || "0") * 100);

    setLoading(true);
    try {
      await trpc.market.create.mutate({
        question: question.trim(),
        outcomeLabels: trimmedOutcomes,
        bFloorOverride: bFloor ? parseFloat(bFloor) : undefined,
        scheduledOpenAt:
          openMode === "scheduled" && scheduledAt
            ? new Date(scheduledAt)
            : undefined,
        eventTag: eventTag || undefined,
        familySide: familySide || undefined,
        customTags: customTags.length ? customTags : undefined,
        seedAmountCents: isNaN(seedAmountCents) ? 0 : seedAmountCents,
      });
      // Reset form
      setQuestion("");
      setOutcomes(["Yes", "No"]);
      setBFloor("");
      setOpenMode("now");
      setScheduledAt("");
      setEventTag("");
      setFamilySide("");
      setCustomTagsRaw("");
      setSeedDollars("20");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create market");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[rgba(184,134,11,0.12)] bg-white p-6 shadow-sm space-y-4"
    >
      <h2 className="text-base font-semibold text-charcoal">
        Create New Market
      </h2>

      {/* Question */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-1">
          Question
        </label>
        <input
          type="text"
          required
          maxLength={500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Will the groom cry during the pheras?"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
      </div>

      {/* Outcomes */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-1">
          Outcomes ({outcomes.length}/{MAX_OUTCOMES})
        </label>
        <div className="space-y-2">
          {outcomes.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                required
                maxLength={100}
                value={o}
                onChange={(e) => updateOutcome(i, e.target.value)}
                placeholder={`Outcome ${i + 1}`}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              {outcomes.length > MIN_OUTCOMES && (
                <button
                  type="button"
                  onClick={() => removeOutcome(i)}
                  className="text-red-500 hover:text-red-700 text-sm px-2 min-h-0 min-w-0 h-auto"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {outcomes.length < MAX_OUTCOMES && (
          <button
            type="button"
            onClick={addOutcome}
            className="mt-2 text-sm text-warmGray hover:text-charcoal underline min-h-0 min-w-0 h-auto"
          >
            + Add outcome
          </button>
        )}
      </div>

      {/* Event tag */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-1">
          Wedding Event{" "}
          <span className="text-warmGray font-normal">(optional)</span>
        </label>
        <select
          value={eventTag}
          onChange={(e) => setEventTag(e.target.value as EventTag | "")}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
        >
          <option value="">— None —</option>
          {EVENT_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </div>

      {/* Family side */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-2">
          Family Side{" "}
          <span className="text-warmGray font-normal">(optional)</span>
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          {(["", ...FAMILY_SIDES] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => setFamilySide(side as FamilySide | "")}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                familySide === side
                  ? side === "Spoorthi"
                    ? "bg-rose-600 text-white border-rose-600"
                    : side === "Parsh"
                    ? "bg-sky-600 text-white border-sky-600"
                    : side === "Both"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-gray-700 text-white border-gray-700"
                  : "bg-white text-warmGray border-gray-300 hover:border-gray-400"
              }`}
            >
              {side === "" ? "None" : side}
            </button>
          ))}
        </div>
      </div>

      {/* Custom tags */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-1">
          Custom Tags{" "}
          <span className="text-warmGray font-normal">
            (optional, comma-separated)
          </span>
        </label>
        <input
          type="text"
          value={customTagsRaw}
          onChange={(e) => setCustomTagsRaw(e.target.value)}
          placeholder="dance, emotional, food"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
      </div>

      {/* b_floor override */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-1">
          b_floor override{" "}
          <span className="text-warmGray font-normal">(optional, default 20)</span>
        </label>
        <input
          type="number"
          min="1"
          step="any"
          value={bFloor}
          onChange={(e) => setBFloor(e.target.value)}
          placeholder="20"
          className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />
      </div>

      {/* House seed amount */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-1">
          House seed per outcome{" "}
          <span className="text-warmGray font-normal">(dollars, 0 to disable)</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-warmGray">$</span>
          <input
            type="number"
            min="0"
            max="1000"
            step="1"
            value={seedDollars}
            onChange={(e) => setSeedDollars(e.target.value)}
            placeholder="20"
            className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <span className="text-xs text-warmGray">per outcome</span>
        </div>
        {parseFloat(seedDollars || "0") > 0 && (
          <p className="mt-1 text-xs text-warmGray">
            Total seeding: ${(parseFloat(seedDollars || "0") * Math.max(outcomes.filter(Boolean).length, 2)).toFixed(0)} across all outcomes
          </p>
        )}
      </div>

      {/* Open time */}
      <div>
        <label className="block text-sm font-medium text-charcoal mb-1">
          Open Time
        </label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="openMode"
              value="now"
              checked={openMode === "now"}
              onChange={() => setOpenMode("now")}
            />
            Open immediately
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="openMode"
              value="scheduled"
              checked={openMode === "scheduled"}
              onChange={() => setOpenMode("scheduled")}
            />
            Schedule
          </label>
        </div>
        {openMode === "scheduled" && (
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-2 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
      >
        {loading ? "Creating…" : "Create Market"}
      </button>
    </form>
  );
}
