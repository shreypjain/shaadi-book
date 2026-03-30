"use client";

/**
 * Admin User Manager — Task 4.3
 *
 * Lists all registered guests with balance, bet count, and flags.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import UserRow, { type UserRowData } from "@/components/admin/UserRow";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.admin.listUsers.query();
      type ResultRow = (typeof result)[number];
      const rows: UserRowData[] = result.map((u: ResultRow) => ({
        ...u,
        createdAt: new Date(u.createdAt),
      }));
      setUsers(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = search
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(search.toLowerCase()) ||
          u.phone.includes(search)
      )
    : users;

  const suspiciousCount = users.filter((u) => u.suspicious).length;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-charcoal">User Manager</h1>
          <p className="text-sm text-warmGray mt-0.5">
            {users.length} registered ·{" "}
            {suspiciousCount > 0 && (
              <span className="text-red-600 font-medium">
                {suspiciousCount} flagged
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-sm text-warmGray hover:text-charcoal disabled:opacity-50 min-h-0 min-w-0 h-auto"
        >
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name or phone…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
      />

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p className="text-sm text-warmGray">No users found.</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-[rgba(184,134,11,0.12)] bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-[rgba(184,134,11,0.12)] bg-cream-100">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-warmGray">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-warmGray">
                  Country
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-warmGray">
                  Balance
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-warmGray">
                  Total Bets
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-warmGray">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
