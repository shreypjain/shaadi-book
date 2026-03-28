"use client";

import { useState, useEffect } from "react";
import { api, formatDollars, type CharityInfo } from "@/lib/api";

interface WithdrawalFormProps {
  balanceCents: number;
  onSuccess?: () => void;
  onCancel?: () => void;
}

/**
 * Withdrawal request form.
 * Accepts amount + Venmo handle OR Zelle email/phone.
 * Submits a pending withdrawal request (admin processes manually post-event).
 *
 * Shows charity fee breakdown when the wallet.charityInfo endpoint is available.
 *
 * PRD §7.3 — Withdrawal flow
 */
export function WithdrawalForm({
  balanceCents,
  onSuccess,
  onCancel,
}: WithdrawalFormProps) {
  const [amountDollars, setAmountDollars] = useState("");
  const [venmoHandle, setVenmoHandle] = useState("");
  const [zelleContact, setZelleContact] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [charityInfo, setCharityInfo] = useState<CharityInfo | null>(null);

  // Fetch charity info conditionally — endpoint may not exist yet, so we
  // swallow errors and only show the section if data is available.
  useEffect(() => {
    api.wallet
      .charityInfo()
      .then(setCharityInfo)
      .catch(() => {
        // endpoint not yet deployed — gracefully hide the section
      });
  }, []);

  // When charityRemainingCents is known, cap withdrawals at balance minus
  // what is owed to charity.
  const effectiveMaxCents = charityInfo
    ? Math.max(0, balanceCents - charityInfo.charityRemainingCents)
    : balanceCents;

  const amountCents = Math.round(parseFloat(amountDollars || "0") * 100);
  const isValid =
    amountCents >= 100 &&
    amountCents <= effectiveMaxCents &&
    (venmoHandle.trim().length > 0 || zelleContact.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      await api.wallet.requestWithdrawal({
        amountCents,
        venmoHandle: venmoHandle.trim() || undefined,
        zelleContact: zelleContact.trim() || undefined,
      });
      setSuccess(true);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl bg-green-50 border border-green-200 p-5 text-center">
        <p className="text-2xl mb-2">✓</p>
        <p className="font-semibold text-green-800">Withdrawal requested!</p>
        <p className="text-sm text-green-600 mt-1">
          Shrey will send your payout via Venmo/Zelle after the event.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Charity fee breakdown — only shown when endpoint is available */}
      {charityInfo && (
        <div className="rounded-xl bg-[#f5efd9] border border-[#e8dbb8] px-4 py-3 space-y-1.5">
          <p className="text-xs font-bold text-[#8a6d30] uppercase tracking-wide mb-2">
            Charity Breakdown
          </p>
          <div className="flex justify-between text-sm">
            <span className="text-[#8a6d30]">Your profit</span>
            <span className="font-semibold text-[#8a6d30]">
              {formatDollars(charityInfo.profitCents)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#8a6d30]">20% charity fee</span>
            <span className="font-semibold text-[#8a6d30]">
              − {formatDollars(charityInfo.charityRemainingCents)}
            </span>
          </div>
          <div className="border-t border-[#e8dbb8] pt-1.5 flex justify-between text-sm">
            <span className="font-semibold text-[#8a6d30]">
              Available to withdraw
            </span>
            <span className="font-bold text-[#8a6d30]">
              {formatDollars(effectiveMaxCents)}
            </span>
          </div>
        </div>
      )}

      {/* Amount */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
            $
          </span>
          <input
            type="number"
            min="1"
            max={(effectiveMaxCents / 100).toFixed(2)}
            step="0.01"
            placeholder="0.00"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            required
            className="w-full pl-7 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm
                       focus:outline-none focus:border-brand-400 transition"
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Available: {formatDollars(effectiveMaxCents)}
        </p>
        {amountCents > effectiveMaxCents && amountCents > 0 && (
          <p className="text-xs text-red-500 mt-1">
            Amount exceeds your available balance.
          </p>
        )}
      </div>

      {/* Venmo */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Venmo Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            @
          </span>
          <input
            type="text"
            placeholder="your-venmo"
            value={venmoHandle}
            onChange={(e) => setVenmoHandle(e.target.value)}
            className="w-full pl-7 pr-4 py-3 border-2 border-gray-200 rounded-xl text-sm
                       focus:outline-none focus:border-brand-400 transition"
          />
        </div>
      </div>

      <p className="text-center text-xs text-gray-400 font-medium">— or —</p>

      {/* Zelle */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Zelle Email or Phone
        </label>
        <input
          type="text"
          placeholder="email@example.com or +1 555 000 0000"
          value={zelleContact}
          onChange={(e) => setZelleContact(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm
                     focus:outline-none focus:border-brand-400 transition"
        />
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-sm
                       font-semibold text-gray-600 hover:border-gray-300 transition"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!isValid || loading}
          className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-semibold
                     text-sm disabled:opacity-50 hover:bg-brand-700 active:scale-95 transition-all"
        >
          {loading ? "Submitting…" : "Request Withdrawal"}
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center">
        All payouts are processed manually post-event by Shrey.
      </p>
    </form>
  );
}
