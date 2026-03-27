"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const PRESETS = [
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500 },
  { label: "$50", cents: 5000 },
];

interface DepositButtonProps {
  onSuccess?: () => void;
}

/**
 * "Add Credits" button that opens a deposit modal.
 * Preset amounts ($10, $25, $50) + custom input.
 * On confirm, creates a Stripe Checkout session and redirects.
 *
 * PRD §7.2 — Deposit flow
 */
export function DepositButton({ onSuccess }: DepositButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedCents, setSelectedCents] = useState<number | null>(1000);
  const [customDollars, setCustomDollars] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveCents: number | null = customDollars
    ? Math.round(parseFloat(customDollars) * 100)
    : selectedCents;

  const isValidAmount =
    effectiveCents !== null &&
    !isNaN(effectiveCents) &&
    effectiveCents >= 500 &&
    effectiveCents <= 50000;

  async function handleDeposit() {
    if (!isValidAmount || effectiveCents === null) return;
    setLoading(true);
    setError(null);
    try {
      const { checkoutUrl } = await api.wallet.createDeposit({
        amountCents: effectiveCents,
      });
      onSuccess?.();
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment setup failed.");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex-1 rounded-xl bg-brand-600 px-5 py-3 text-white font-semibold
                   text-sm hover:bg-brand-700 active:scale-95 transition-all"
      >
        + Add Credits
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div className="relative w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              Add Credits
            </h2>
            <p className="text-xs text-gray-400 mb-5">
              Charged in USD via Stripe (Apple Pay / card)
            </p>

            {/* Preset amounts */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {PRESETS.map((p) => (
                <button
                  key={p.cents}
                  onClick={() => {
                    setSelectedCents(p.cents);
                    setCustomDollars("");
                  }}
                  className={`rounded-xl py-3 text-sm font-semibold border-2 transition-all
                    ${
                      !customDollars && selectedCents === p.cents
                        ? "border-brand-600 bg-brand-50 text-brand-700"
                        : "border-gray-200 text-gray-700 hover:border-brand-300"
                    }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="relative mb-4">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
                $
              </span>
              <input
                type="number"
                min="5"
                max="500"
                step="1"
                placeholder="Custom amount"
                value={customDollars}
                onChange={(e) => {
                  setCustomDollars(e.target.value);
                  setSelectedCents(null);
                }}
                className="w-full pl-7 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm
                           focus:outline-none focus:border-brand-400 transition"
              />
            </div>

            <p className="text-xs text-gray-400 mb-4">Min $5 · Max $500</p>

            {error && (
              <p className="text-xs text-red-600 mb-3 bg-red-50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              onClick={handleDeposit}
              disabled={!isValidAmount || loading}
              className="w-full rounded-xl bg-brand-600 py-3.5 text-white font-semibold
                         disabled:opacity-50 hover:bg-brand-700 active:scale-95 transition-all"
            >
              {loading
                ? "Redirecting to Stripe…"
                : `Pay ${
                    isValidAmount && effectiveCents
                      ? `$${(effectiveCents / 100).toFixed(2)}`
                      : ""
                  } →`}
            </button>

            <button
              onClick={() => setOpen(false)}
              className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
