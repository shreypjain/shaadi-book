"use client";

/**
 * SuggestMarketModal — Modal dialog for guests to suggest new prediction markets.
 *
 * Features:
 *   - Question text input (required, 5–500 chars)
 *   - Dynamic outcomes list (2–5, default Yes/No)
 *   - Optional description textarea
 *   - Loading state on submit
 *   - Success state with confetti-style feedback
 *   - Error state
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const MIN_OUTCOMES = 2;
const MAX_OUTCOMES = 5;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SuggestMarketModal({ isOpen, onClose }: Props) {
  const [questionText, setQuestionText] = useState("");
  const [outcomes, setOutcomes] = useState<string[]>(["Yes", "No"]);
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus the first input when the modal opens
  useEffect(() => {
    if (isOpen) {
      setIsSuccess(false);
      setError(null);
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Outcome helpers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedQuestion = questionText.trim();
    const trimmedOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
    const trimmedDesc = description.trim();

    if (trimmedQuestion.length < 5) {
      setError("Question must be at least 5 characters long.");
      return;
    }
    if (trimmedOutcomes.length < MIN_OUTCOMES) {
      setError("Please add at least 2 outcomes.");
      return;
    }

    setIsLoading(true);
    try {
      await api.suggest.submit({
        questionText: trimmedQuestion,
        outcomes: trimmedOutcomes,
        description: trimmedDesc || undefined,
      });
      setIsSuccess(true);
      // Reset form
      setQuestionText("");
      setOutcomes(["Yes", "No"]);
      setDescription("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to submit suggestion. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleClose() {
    if (!isLoading) {
      setIsSuccess(false);
      setError(null);
      onClose();
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggest-modal-title"
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <div
          className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ece7] shrink-0">
            <div>
              <h2
                id="suggest-modal-title"
                className="text-base font-bold text-charcoal tracking-tight"
              >
                Suggest a Market
              </h2>
              <p className="text-xs text-warmGray mt-0.5">
                Propose a prediction market for Parsh &amp; Spoorthi's wedding
              </p>
            </div>
            <button
              onClick={handleClose}
              disabled={isLoading}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-warmGray hover:bg-[#f0ece7] hover:text-charcoal transition-colors disabled:opacity-50"
              aria-label="Close modal"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1">
            {isSuccess ? (
              /* Success state */
              <div className="flex flex-col items-center justify-center px-6 py-12 gap-4 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                  <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-base font-semibold text-charcoal">
                    Suggestion submitted!
                  </p>
                  <p className="text-sm text-warmGray mt-1 max-w-xs">
                    The admins will review your idea and let you know. Check "My Suggestions" to track the status.
                  </p>
                </div>
                <div className="mt-2 flex flex-col items-center gap-2">
                  <button
                    onClick={handleClose}
                    className="rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm px-6 py-2.5 hover:bg-[#162d4a] transition-colors"
                  >
                    Done
                  </button>
                  <Link
                    href="/suggestions"
                    onClick={handleClose}
                    className="text-xs text-[#c8a45c] hover:text-[#a8843c] underline transition-colors"
                  >
                    View my suggestions →
                  </Link>
                </div>
              </div>
            ) : (
              /* Form */
              <form onSubmit={(e) => void handleSubmit(e)} className="px-5 py-5 space-y-5">
                {/* Question */}
                <div>
                  <label
                    htmlFor="suggestion-question"
                    className="block text-sm font-semibold text-charcoal mb-1.5"
                  >
                    Your question <span className="text-[#dc2626]">*</span>
                  </label>
                  <input
                    ref={firstInputRef}
                    id="suggestion-question"
                    type="text"
                    required
                    maxLength={500}
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                    placeholder="Will the baraat arrive on time?"
                    className="w-full rounded-xl border border-[rgba(184,134,11,0.12)] bg-[#faf9f7] px-4 py-3 text-sm text-charcoal placeholder:text-[#c0bbb5] focus:outline-none focus:ring-2 focus:ring-[#c8a45c]/40 focus:border-[#c8a45c] transition-colors"
                  />
                  <p className="mt-1 text-xs text-warmGray">
                    {questionText.length}/500
                  </p>
                </div>

                {/* Outcomes */}
                <div>
                  <label className="block text-sm font-semibold text-charcoal mb-1.5">
                    Possible outcomes{" "}
                    <span className="text-[#dc2626]">*</span>
                    <span className="text-warmGray font-normal ml-1">
                      ({outcomes.length}/{MAX_OUTCOMES})
                    </span>
                  </label>
                  <div className="space-y-2">
                    {outcomes.map((outcome, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            required
                            maxLength={100}
                            value={outcome}
                            onChange={(e) => updateOutcome(i, e.target.value)}
                            placeholder={
                              i === 0
                                ? "e.g. Yes"
                                : i === 1
                                ? "e.g. No"
                                : `Outcome ${i + 1}`
                            }
                            className="w-full rounded-xl border border-[rgba(184,134,11,0.12)] bg-[#faf9f7] px-4 py-2.5 text-sm text-charcoal placeholder:text-[#c0bbb5] focus:outline-none focus:ring-2 focus:ring-[#c8a45c]/40 focus:border-[#c8a45c] transition-colors"
                          />
                        </div>
                        {outcomes.length > MIN_OUTCOMES && (
                          <button
                            type="button"
                            onClick={() => removeOutcome(i)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-warmGray hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
                            aria-label={`Remove outcome ${i + 1}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {outcomes.length < MAX_OUTCOMES && (
                    <button
                      type="button"
                      onClick={addOutcome}
                      className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-[#c8a45c] hover:text-[#a8843c] transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add another outcome
                    </button>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label
                    htmlFor="suggestion-description"
                    className="block text-sm font-semibold text-charcoal mb-1.5"
                  >
                    Context{" "}
                    <span className="text-warmGray font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="suggestion-description"
                    maxLength={1000}
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Any extra context that might help the admins understand your suggestion…"
                    className="w-full rounded-xl border border-[rgba(184,134,11,0.12)] bg-[#faf9f7] px-4 py-3 text-sm text-charcoal placeholder:text-[#c0bbb5] focus:outline-none focus:ring-2 focus:ring-[#c8a45c]/40 focus:border-[#c8a45c] transition-colors resize-none"
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="rounded-xl border border-[#dc2626]/20 bg-red-50 px-4 py-3">
                    <p className="text-sm text-[#dc2626]">{error}</p>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-xl bg-[#1e3a5f] text-white font-semibold text-sm py-3 hover:bg-[#162d4a] active:scale-[0.98] transition-all duration-150 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Submitting…
                    </>
                  ) : (
                    "Submit Suggestion"
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
