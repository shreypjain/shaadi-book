/**
 * utils.ts — shared client-side utility functions.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// ---------------------------------------------------------------------------
// Tailwind class merge helper
// ---------------------------------------------------------------------------

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Price formatting
// ---------------------------------------------------------------------------

/**
 * Format a price in cents (0–100) as a currency string.
 * 62 → "62¢"
 * 100 → "$1.00"
 */
export function formatPriceCents(priceCents: number): string {
  if (priceCents >= 100) return "$1.00";
  if (priceCents <= 0) return "$0.00";
  return `${Math.round(priceCents)}¢`;
}

/**
 * Format a fractional price (0–1) as a currency string.
 * 0.62 → "62¢"
 */
export function formatPrice(price: number): string {
  return formatPriceCents(price * 100);
}

/**
 * Format a dollar amount: 14.3 → "$14.30"
 */
export function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format shares: 14.3456 → "14.35"
 */
export function formatShares(shares: number): string {
  return shares.toFixed(2);
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Human-readable relative time from a past Date.
 * Returns "just now", "2 min ago", "1 hr ago", etc.
 */
export function timeSince(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * Return ms elapsed since the given Date.
 */
export function msSince(date: Date): number {
  return Date.now() - date.getTime();
}

// ---------------------------------------------------------------------------
// Market badge logic
// ---------------------------------------------------------------------------

const NEW_BADGE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const LOW_ACTIVITY_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * True if the market was opened less than 5 minutes ago.
 */
export function isNewMarket(openedAt: Date | null): boolean {
  if (!openedAt) return false;
  return msSince(openedAt) < NEW_BADGE_THRESHOLD_MS;
}

/**
 * True if the last purchase was more than 30 minutes ago (or never).
 * `lastPurchaseAt` is the timestamp of the most recent purchase, or null.
 */
export function isLowActivity(
  openedAt: Date | null,
  lastPurchaseAt: Date | null
): boolean {
  if (!openedAt) return false;
  // If no purchases yet and market has been open > 30 min
  if (!lastPurchaseAt) {
    return msSince(openedAt) > LOW_ACTIVITY_THRESHOLD_MS;
  }
  return msSince(lastPurchaseAt) > LOW_ACTIVITY_THRESHOLD_MS;
}

// ---------------------------------------------------------------------------
// Outcome color palette — wedding rose/amber theme
// ---------------------------------------------------------------------------

const OUTCOME_COLORS = [
  { bg: "bg-rose-500", bar: "bg-rose-400", text: "text-rose-700", light: "bg-rose-50", border: "border-rose-200" },
  { bg: "bg-amber-500", bar: "bg-amber-400", text: "text-amber-700", light: "bg-amber-50", border: "border-amber-200" },
  { bg: "bg-violet-500", bar: "bg-violet-400", text: "text-violet-700", light: "bg-violet-50", border: "border-violet-200" },
  { bg: "bg-emerald-500", bar: "bg-emerald-400", text: "text-emerald-700", light: "bg-emerald-50", border: "border-emerald-200" },
  { bg: "bg-sky-500", bar: "bg-sky-400", text: "text-sky-700", light: "bg-sky-50", border: "border-sky-200" },
];

export function outcomeColor(index: number) {
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length]!;
}

// ---------------------------------------------------------------------------
// Volume formatting
// ---------------------------------------------------------------------------

export function formatVolume(dollars: number): string {
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${Math.floor(dollars)}`;
}
