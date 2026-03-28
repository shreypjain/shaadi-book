"use client";

/**
 * PriceChart.tsx — Live recharts line chart for outcome price history.
 *
 * Shows one colored line per outcome over time.
 * X-axis: wall-clock time (epoch ms); Y-axis: price in cents (0–100).
 * Updates in real-time as new data points are appended by the market detail page.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Each entry is a snapshot in time: { time: epochMs, [outcomeId]: priceCents } */
export interface ChartDataPoint {
  time: number;
  [outcomeId: string]: number;
}

export interface ChartOutcome {
  id: string;
  label: string;
}

interface PriceChartProps {
  data: ChartDataPoint[];
  outcomes: ChartOutcome[];
}

// ---------------------------------------------------------------------------
// Colors — aligned to the brand palette used in ProbabilityBar / outcomeColor
// Royal blue (primary), gold/amber (secondary), teal, emerald, violet
// ---------------------------------------------------------------------------

const LINE_COLORS = ["#3b6fa3", "#d97706", "#0d9488", "#059669", "#7c3aed"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Custom tooltip — uses explicit props interface to avoid recharts generic hell
// ---------------------------------------------------------------------------

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number | string;
  outcomes: ChartOutcome[];
}

function CustomTooltip({ active, payload, label, outcomes }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const ts = typeof label === "number" ? label : Number(label);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8e4df",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        color: "#1a1a2e",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}
    >
      <p style={{ color: "#8a8a9a", marginBottom: 4, fontWeight: 500 }}>
        {formatTime(ts)}
      </p>
      {payload.map((entry) => {
        const key = String(entry.dataKey ?? "");
        const outcome = outcomes.find((o) => o.id === key);
        const name = outcome?.label ?? key;
        return (
          <p key={key} style={{ color: entry.color ?? "#3b6fa3", margin: "2px 0" }}>
            <span style={{ fontWeight: 600 }}>{name}</span>
            {": "}
            <span>{Math.round(Number(entry.value ?? 0))}¢</span>
          </p>
        );
      })}
    </div>
  );
}

// Recharts Tooltip's `content` prop accepts `any` compatible renderer;
// we use an inline cast to satisfy the strict generic bounds.
type AnyTooltipContent = Parameters<typeof Tooltip>[0]["content"];

// ---------------------------------------------------------------------------
// PriceChart component
// ---------------------------------------------------------------------------

export function PriceChart({ data, outcomes }: PriceChartProps) {
  // Need at least 2 points to draw a line
  if (data.length < 2) return null;

  const tooltipContent: AnyTooltipContent = (props) => {
    const p = props as unknown as {
      active?: boolean;
      payload?: TooltipEntry[];
      label?: number | string;
    };
    return (
      <CustomTooltip
        active={p.active}
        payload={p.payload}
        label={p.label}
        outcomes={outcomes}
      />
    );
  };

  return (
    // 200px on mobile, 250px on desktop (md+)
    <div className="h-[200px] md:h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
        >
          {/* Subtle horizontal grid only */}
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ece7" vertical={false} />

          {/* X-axis: time */}
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatTime}
            tick={{ fontSize: 10, fill: "#8a8a9a" }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />

          {/* Y-axis: price in cents */}
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}¢`}
            tick={{ fontSize: 10, fill: "#8a8a9a" }}
            tickLine={false}
            axisLine={false}
            width={36}
            ticks={[0, 25, 50, 75, 100]}
          />

          {/* Custom tooltip */}
          <Tooltip content={tooltipContent} />

          {/* One line per outcome */}
          {outcomes.map((outcome, i) => (
            <Line
              key={outcome.id}
              type="monotone"
              dataKey={outcome.id}
              name={outcome.label}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              isAnimationActive
              animationDuration={400}
              animationEasing="ease-out"
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
