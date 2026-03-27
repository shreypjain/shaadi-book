/**
 * DashboardStat — compact stat card for the admin dashboard.
 */

interface Props {
  label: string;
  value: string;
  subtext?: string;
  /** Tailwind colour class for the accent, e.g. "text-emerald-600" */
  accent?: string;
}

export default function DashboardStat({
  label,
  value,
  subtext,
  accent = "text-gray-900",
}: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {subtext && (
        <p className="mt-0.5 text-xs text-gray-500">{subtext}</p>
      )}
    </div>
  );
}
