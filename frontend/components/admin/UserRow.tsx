/**
 * UserRow — one row in the admin user manager table.
 */

export interface UserRowData {
  id: string;
  name: string;
  phone: string;
  country: "US" | "IN";
  role: "guest" | "admin";
  balanceCents: number;
  totalBets: number;
  createdAt: Date | string;
  suspicious: boolean;
}

interface Props {
  user: UserRowData;
}

function formatUSD(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function UserRow({ user }: Props) {
  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
      <td className="px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <div>
            <p className="font-medium text-gray-800">{user.name}</p>
            <p className="text-xs text-gray-400">{user.phone}</p>
          </div>
          {user.suspicious && (
            <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
              ⚠ suspicious
            </span>
          )}
          {user.role === "admin" && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
              admin
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{user.country}</td>
      <td className="px-4 py-3 text-sm font-semibold text-gray-800">
        {formatUSD(user.balanceCents)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 text-right">
        {user.totalBets}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
    </tr>
  );
}
