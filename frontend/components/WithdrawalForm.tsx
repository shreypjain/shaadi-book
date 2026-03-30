"use client";

import { useState } from "react";
import { api, formatDollars } from "@/lib/api";

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

  const amountCents = Math.round(parseFloat(amountDollars || "0") * 100);
  const isValid =
    amountCents >= 100 &&
    amountCents <= balanceCents &&
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
        <p className="font-semibold text-green-800">Withdrawal requested</p>
        <p className="text-sm text-green-600 mt-1">
          Shrey will send your payout via Venmo/Zelle after the event.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Amount */}
      <div>
        <label className="block text-xs font-semibold text-warmGray uppercase tracking-wide mb-1.5">
          Amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warmGray font-medium">
            $
          </span>
          <input
            type="number"
            min="1"
            max={(balanceCents / 100).toFixed(2)}
            step="0.01"
            placeholder="0.00"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            required
            className="w-full pl-7 pr-4 py-3 border-2 border-[rgba(184,134,11,0.12)] rounded-xl text-sm
                       focus:outline-none focus:border-brand-400 transition"
          />
        </div>
        <p className="text-xs text-warmGray mt-1">
          Available: {formatDollars(balanceCents)}
        </p>
        {amountCents > balanceCents && amountCents > 0 && (
          <p className="text-xs text-red-500 mt-1">
            Amount exceeds your balance.
          </p>
        )}
      </div>

      {/* Venmo */}
      <div>
        <label className="block text-xs font-semibold text-warmGray uppercase tracking-wide mb-1.5">
          Venmo Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warmGray">
            @
          </span>
          <input
            type="text"
            placeholder="your-venmo"
            value={venmoHandle}
            onChange={(e) => setVenmoHandle(e.target.value)}
            className="w-full pl-7 pr-4 py-3 border-2 border-[rgba(184,134,11,0.12)] rounded-xl text-sm
                       focus:outline-none focus:border-brand-400 transition"
          />
        </div>
      </div>

      <p className="text-center text-xs text-warmGray font-medium">— or —</p>

      {/* Zelle */}
      <div>
        <label className="block text-xs font-semibold text-warmGray uppercase tracking-wide mb-1.5">
          Zelle Email or Phone
        </label>
        <input
          type="text"
          placeholder="email@example.com or +1 555 000 0000"
          value={zelleContact}
          onChange={(e) => setZelleContact(e.target.value)}
          className="w-full px-4 py-3 border-2 border-[rgba(184,134,11,0.12)] rounded-xl text-sm
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
            className="flex-1 py-3 rounded-xl border-2 border-[rgba(184,134,11,0.12)] text-sm
                       font-semibold text-warmGray hover:border-gray-300 transition"
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

      <p className="text-xs text-warmGray text-center">
        All payouts are processed manually post-event by Shrey.
      </p>
    </form>
  );
}
