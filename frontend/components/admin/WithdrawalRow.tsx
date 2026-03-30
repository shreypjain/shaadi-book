"use client";

/**
 * WithdrawalRow — one row in the admin withdrawal queue.
 *
 * PENDING  → Approve / Reject buttons
 * APPROVED → Mark Sent (complete) button
 * REJECTED / COMPLETED → read-only
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

export interface WithdrawalRowData {
  id: string;
  userName: string;
  userPhone: string;
  amountCents: number;
  venmoHandle: string | null;
  zelleContact: string | null;
  status: "pending" | "approved" | "rejected" | "completed";
  adminName: string | null;
  processedAt: Date | string | null;
  createdAt: Date | string;
}

interface Props {
  withdrawal: WithdrawalRowData;
  onChanged: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-yellow-100 text-yellow-800",
  approved:  "bg-blue-100   text-blue-800",
  rejected:  "bg-red-100    text-red-700",
  completed: "bg-green-100  text-green-800",
};

function formatUSD(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function WithdrawalRow({ withdrawal, onChanged }: Props) {
  const [confirming, setConfirming] = useState<null | "approve" | "reject" | "complete">(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: "approve" | "reject" | "complete") {
    setLoading(true);
    setError(null);
    try {
      if (action === "approve") {
        await trpc.admin.approveWithdrawal.mutate({ withdrawalId: withdrawal.id });
      } else if (action === "reject") {
        await trpc.admin.rejectWithdrawal.mutate({ withdrawalId: withdrawal.id });
      } else {
        await trpc.admin.completeWithdrawal.mutate({ withdrawalId: withdrawal.id });
      }
      setConfirming(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  const payoutInfo =
    withdrawal.venmoHandle
      ? `Venmo: @${withdrawal.venmoHandle}`
      : withdrawal.zelleContact
      ? `Zelle: ${withdrawal.zelleContact}`
      : "—";

  return (
    <tr className="border-b border-[rgba(184,134,11,0.12)] last:border-0 hover:bg-cream-100">
      <td className="px-4 py-3 text-sm">
        <p className="font-medium text-charcoal">{withdrawal.userName}</p>
        <p className="text-xs text-warmGray">{withdrawal.userPhone}</p>
      </td>
      <td className="px-4 py-3 text-sm font-semibold text-charcoal">
        {formatUSD(withdrawal.amountCents)}
      </td>
      <td className="px-4 py-3 text-xs text-warmGray">{payoutInfo}</td>
      <td className="px-4 py-3 text-xs text-warmGray">
        {new Date(withdrawal.createdAt).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_COLORS[withdrawal.status] ?? ""
          }`}
        >
          {withdrawal.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">
        {error && <p className="text-xs text-red-600 mb-1">{error}</p>}

        {withdrawal.status === "pending" && (
          <>
            {confirming === "approve" ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleAction("approve")}
                  disabled={loading}
                  className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                >
                  {loading ? "…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  className="text-xs text-warmGray min-h-0 min-w-0 h-auto"
                >
                  Cancel
                </button>
              </div>
            ) : confirming === "reject" ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleAction("reject")}
                  disabled={loading}
                  className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                >
                  {loading ? "…" : "Confirm reject"}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  className="text-xs text-warmGray min-h-0 min-w-0 h-auto"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setConfirming("approve")}
                  className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 min-h-0 min-w-0 h-auto"
                >
                  Approve
                </button>
                <button
                  onClick={() => setConfirming("reject")}
                  className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 min-h-0 min-w-0 h-auto"
                >
                  Reject
                </button>
              </div>
            )}
          </>
        )}

        {withdrawal.status === "approved" && (
          <>
            {confirming === "complete" ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-warmGray">
                  Confirm payment sent?
                </span>
                <button
                  onClick={() => handleAction("complete")}
                  disabled={loading}
                  className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
                >
                  {loading ? "…" : "Yes"}
                </button>
                <button
                  onClick={() => setConfirming(null)}
                  className="text-xs text-warmGray min-h-0 min-w-0 h-auto"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming("complete")}
                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 min-h-0 min-w-0 h-auto"
              >
                Mark Sent
              </button>
            )}
          </>
        )}

        {(withdrawal.status === "completed" || withdrawal.status === "rejected") && (
          <span className="text-xs text-warmGray">
            {withdrawal.processedAt
              ? new Date(withdrawal.processedAt).toLocaleString()
              : "—"}
            {withdrawal.adminName ? ` by ${withdrawal.adminName}` : ""}
          </span>
        )}
      </td>
    </tr>
  );
}
