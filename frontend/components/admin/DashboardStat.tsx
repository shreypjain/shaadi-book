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
  accent = "text-charcoal",
}: Props) {
  return (
    <div className="rounded-lg border border-[rgba(184,134,11,0.12)] bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-warmGray">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {subtext && (
        <p className="mt-0.5 text-xs text-warmGray">{subtext}</p>
      )}
    </div>
  );
}
