"use client";

/**
 * Admin Withdrawal Queue — Task 4.3
 *
 * Lists pending withdrawal requests (Approve / Reject) and completed ones.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import WithdrawalRow, {
  type WithdrawalRowData,
} from "@/components/admin/WithdrawalRow";

type WithdrawalList = WithdrawalRowData[];

export default function AdminWithdrawalsPage() {
  const [pending, setPending] = useState<WithdrawalList>([]);
  const [approved, setApproved] = useState<WithdrawalList>([]);
  const [completed, setCompleted] = useState<WithdrawalList>([]);
  const [rejected, setRejected] = useState<WithdrawalList>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.admin.listWithdrawals.query();
      type ResultRow = (typeof result)[number];
      const rows: WithdrawalList = result.map((r: ResultRow) => ({
        ...r,
        createdAt: new Date(r.createdAt),
        processedAt: r.processedAt ? new Date(r.processedAt) : null,
      }));

      setPending(rows.filter((r: WithdrawalRowData) => r.status === "pending"));
      setApproved(rows.filter((r: WithdrawalRowData) => r.status === "approved"));
      setRejected(rows.filter((r: WithdrawalRowData) => r.status === "rejected"));
      setCompleted(rows.filter((r: WithdrawalRowData) => r.status === "completed"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load withdrawals"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function tableSection(title: string, rows: WithdrawalList) {
    if (rows.length === 0) return null;
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                  User
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                  Amount
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                  Payout Method
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                  Requested
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <WithdrawalRow
                  key={w.id}
                  withdrawal={w}
                  onChanged={() => void load()}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Withdrawal Queue</h1>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 min-h-0 min-w-0 h-auto"
        >
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading &&
        pending.length === 0 &&
        approved.length === 0 &&
        rejected.length === 0 &&
        completed.length === 0 && (
          <p className="text-sm text-gray-400">No withdrawal requests yet.</p>
        )}

      {tableSection(`Pending (${pending.length})`, pending)}
      {tableSection(`Approved — awaiting payment (${approved.length})`, approved)}
      {tableSection(`Completed (${completed.length})`, completed)}
      {tableSection(`Rejected (${rejected.length})`, rejected)}
    </div>
  );
}
