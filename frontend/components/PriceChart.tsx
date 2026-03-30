"use client";

/**
 * PriceChart — SVG-based price history chart for a prediction market.
 *
 * Features:
 *   - One polyline per outcome coloured by the shared outcomeColor palette
 *   - Horizontal grid lines at 25¢, 50¢, 75¢
 *   - Timeframe toggle: 1h | 2h | 4h (controlled — parent owns the state)
 *   - Hover crosshair + tooltip showing exact prices at the cursor time
 *   - Legend below the chart
 *   - Empty state when no snapshot data exists
 *   - Responsive width (SVG fills container; viewBox + getScreenCTM for mouse coords)
 */

import { useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricePoint {
  priceCents: number;
  /** ISO-8601 timestamp string */
  time: string;
}

export interface PriceChartProps {
  /** Price history keyed by outcomeId */
  data: Record<string, PricePoint[]>;
  /** Ordered list of outcomes (position 0…n) */
  outcomes: Array<{ id: string; label: string }>;
  /** Currently selected timeframe in hours */
  hours: 1 | 2 | 4;
  onHoursChange: (h: 1 | 2 | 4) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEFRAMES: Array<1 | 2 | 4> = [1, 2, 4];

/** Line colours — parallel to outcomeColor() in lib/utils.ts */
const LINE_COLORS = ["#3b6fa3", "#d97706", "#0d9488", "#059669", "#7c3aed"];

// ViewBox dimensions
const VB_W = 500;
const VB_H = 160;
const PAD_LEFT = 30;
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;

// Chart area bounds in viewBox space
const CHART_X0 = PAD_LEFT;
const CHART_X1 = VB_W - PAD_RIGHT;
const CHART_Y0 = PAD_TOP;
const CHART_Y1 = VB_H - PAD_BOTTOM;

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function timeToX(tMs: number, sinceMs: number, nowMs: number): number {
  const ratio = (tMs - sinceMs) / (nowMs - sinceMs);
  return CHART_X0 + ratio * (CHART_X1 - CHART_X0);
}

function priceToY(priceCents: number): number {
  // 0¢ → CHART_Y1 (bottom), 100¢ → CHART_Y0 (top)
  return CHART_Y0 + (1 - priceCents / 100) * (CHART_Y1 - CHART_Y0);
}

function buildPolylinePoints(
  pts: PricePoint[],
  sinceMs: number,
  nowMs: number
): string {
  return pts
    .map((pt) => {
      const x = timeToX(new Date(pt.time).getTime(), sinceMs, nowMs).toFixed(2);
      const y = priceToY(pt.priceCents).toFixed(2);
      return `${x},${y}`;
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// X-axis tick labels
// ---------------------------------------------------------------------------

function buildXTicks(
  hours: number,
  sinceMs: number,
  nowMs: number
): Array<{ label: string; x: number }> {
  const ticks: Array<{ label: string; x: number }> = [];
  const tickCount = hours <= 1 ? 4 : hours <= 2 ? 4 : 5;
  for (let i = 0; i <= tickCount; i++) {
    const t = sinceMs + (i / tickCount) * (nowMs - sinceMs);
    const d = new Date(t);
    const label = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    ticks.push({ label, x: timeToX(t, sinceMs, nowMs) });
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PriceChart({ data, outcomes, hours, onHoursChange }: PriceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [hover, setHover] = useState<{
    /** Crosshair X in viewBox units */
    svgX: number;
    /** Tooltip position in container-relative pixels */
    tooltipLeft: number;
    time: string;
    prices: Array<{ label: string; priceCents: number; color: string }>;
  } | null>(null);

  const hasData = outcomes.some((o) => (data[o.id]?.length ?? 0) >= 1);

  const now = Date.now();
  const since = now - hours * 60 * 60 * 1000;

  // -------------------------------------------------------------------------
  // Mouse handlers
  // -------------------------------------------------------------------------

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      const container = containerRef.current;
      if (!svg || !container) return;

      // Convert client coords → viewBox coords using the SVG transform matrix
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPt = pt.matrixTransform(ctm.inverse());

      // Clamp to chart X area
      if (svgPt.x < CHART_X0 || svgPt.x > CHART_X1) {
        setHover(null);
        return;
      }

      // Compute now/since fresh at call time so the callback never closes over
      // a stale render-time value (the component may have rendered long ago).
      const now = Date.now();
      const since = now - hours * 60 * 60 * 1000;

      // Reconstruct hovered timestamp from viewBox X
      const ratio = (svgPt.x - CHART_X0) / (CHART_X1 - CHART_X0);
      const hoverTs = since + ratio * (now - since);

      // Find nearest data point per outcome
      const prices = outcomes
        .map((o, i) => {
          const pts = data[o.id] ?? [];
          if (pts.length === 0) return null;
          const nearest = pts.reduce((best, pt) => {
            const ptMs = new Date(pt.time).getTime();
            const bestMs = new Date(best.time).getTime();
            return Math.abs(ptMs - hoverTs) < Math.abs(bestMs - hoverTs) ? pt : best;
          });
          return {
            label: o.label,
            priceCents: nearest.priceCents,
            color: LINE_COLORS[i % LINE_COLORS.length]!,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (prices.length === 0) {
        setHover(null);
        return;
      }

      // Tooltip left: flip to left side when cursor is past midpoint
      const containerRect = container.getBoundingClientRect();
      const cursorLeft = e.clientX - containerRect.left;
      const tooltipLeft =
        cursorLeft > containerRect.width / 2 ? cursorLeft - 132 : cursorLeft + 12;

      const timeStr = new Date(hoverTs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      setHover({ svgX: svgPt.x, tooltipLeft, time: timeStr, prices });
    },
    [data, outcomes, hours]
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const xTicks = buildXTicks(hours, since, now);

  return (
    <div className="space-y-3">
      {/* ── Timeframe toggle ── */}
      <div className="flex items-center gap-1.5">
        {TIMEFRAMES.map((h) => (
          <button
            key={h}
            onClick={() => onHoursChange(h)}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              hours === h
                ? "bg-[#1e3a5f] text-white"
                : "bg-white border border-[rgba(184,134,11,0.12)] text-warmGray hover:bg-[#f0ece7]"
            }`}
          >
            {h}h
          </button>
        ))}
      </div>

      {/* ── Chart ── */}
      {!hasData ? (
        <div
          className="flex items-center justify-center text-xs text-warmGray"
          style={{ height: VB_H }}
        >
          No price data yet
        </div>
      ) : (
        <div ref={containerRef} className="relative select-none">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ height: VB_H, display: "block" }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* ── Grid lines at 25¢, 50¢, 75¢ ── */}
            {[25, 50, 75].map((g) => {
              const y = priceToY(g);
              return (
                <g key={g}>
                  <line
                    x1={CHART_X0}
                    y1={y}
                    x2={CHART_X1}
                    y2={y}
                    stroke="#f0ece7"
                    strokeWidth={1}
                  />
                  <text
                    x={CHART_X0 - 3}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={8}
                    fill="#8a8a9a"
                  >
                    {g}¢
                  </text>
                </g>
              );
            })}

            {/* ── Axis border lines ── */}
            <line
              x1={CHART_X0}
              y1={priceToY(0)}
              x2={CHART_X1}
              y2={priceToY(0)}
              stroke="#e8e4df"
              strokeWidth={1}
            />
            <line
              x1={CHART_X0}
              y1={priceToY(100)}
              x2={CHART_X1}
              y2={priceToY(100)}
              stroke="#e8e4df"
              strokeWidth={1}
            />

            {/* ── X-axis tick labels ── */}
            {xTicks
              .filter((_, idx) => idx % 2 === 0) // show every other tick to avoid crowding
              .map((tick) => (
                <text
                  key={tick.x}
                  x={tick.x}
                  y={VB_H - 5}
                  textAnchor="middle"
                  fontSize={7}
                  fill="#8a8a9a"
                >
                  {tick.label}
                </text>
              ))}

            {/* ── Price lines ── */}
            {outcomes.map((o, i) => {
              const pts = data[o.id] ?? [];
              if (pts.length < 2) return null;
              const pointsStr = buildPolylinePoints(pts, since, now);
              const color = LINE_COLORS[i % LINE_COLORS.length]!;
              return (
                <polyline
                  key={o.id}
                  points={pointsStr}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}

            {/* Single-point dots (when only one snapshot exists) */}
            {outcomes.map((o, i) => {
              const pts = data[o.id] ?? [];
              if (pts.length !== 1) return null;
              const pt = pts[0]!;
              const cx = timeToX(new Date(pt.time).getTime(), since, now);
              const cy = priceToY(pt.priceCents);
              const color = LINE_COLORS[i % LINE_COLORS.length]!;
              return (
                <circle key={o.id} cx={cx} cy={cy} r={3} fill={color} />
              );
            })}

            {/* ── Hover crosshair ── */}
            {hover && (
              <line
                x1={hover.svgX}
                y1={CHART_Y0}
                x2={hover.svgX}
                y2={CHART_Y1}
                stroke="#8a8a9a"
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeLinecap="round"
              />
            )}
          </svg>

          {/* ── Hover tooltip (outside SVG for crisp text rendering) ── */}
          {hover && (
            <div
              className="absolute top-0 pointer-events-none bg-white border border-[rgba(184,134,11,0.12)] rounded-lg shadow-lg px-2.5 py-2 text-xs z-10 min-w-[120px]"
              style={{ left: hover.tooltipLeft }}
            >
              <p className="text-warmGray font-medium mb-1.5">{hover.time}</p>
              {hover.prices.map((p) => (
                <div key={p.label} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-warmGray flex-1 truncate">{p.label}</span>
                  <span className="text-charcoal font-bold ml-1 tabular-nums">
                    {p.priceCents}¢
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      {hasData && outcomes.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {outcomes.map((o, i) => {
            const color = LINE_COLORS[i % LINE_COLORS.length]!;
            return (
              <div key={o.id} className="flex items-center gap-1.5">
                <svg width={14} height={4} className="flex-shrink-0">
                  <line
                    x1={0}
                    y1={2}
                    x2={14}
                    y2={2}
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-[10px] text-warmGray">{o.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
