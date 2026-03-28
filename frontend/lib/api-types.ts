/**
 * api-types.ts — Frontend type definitions for the tRPC API surface.
 *
 * These mirror the backend router outputs without importing backend source,
 * keeping the frontend independent of backend build artifacts.
 */

// ---------------------------------------------------------------------------
// Market types (mirror backend/src/services/marketService.ts exports)
// ---------------------------------------------------------------------------

export type MarketStatus = "PENDING" | "ACTIVE" | "PAUSED" | "RESOLVED" | "VOIDED";

export interface OutcomeWithPrice {
  id: string;
  label: string;
  position: number;
  sharesSold: number;
  isWinner: boolean | null;
  /** Price in [0, 1]. */
  price: number;
  /** Price in cents (0–100). */
  priceCents: number;
}

export interface MarketWithPrices {
  id: string;
  question: string;
  status: string;
  /** Serialized as ISO string over HTTP */
  openedAt: string | null;
  scheduledOpenAt: string | null;
  bFloorOverride: number | null;
  createdAt: string;
  resolvedAt: string | null;
  winningOutcomeId: string | null;
  outcomes: OutcomeWithPrice[];
  currentB: number;
  totalVolume: number;
  /** Wedding event tag (e.g. 'Sangeet', 'Haldi', 'Reception'). */
  eventTag: string | null;
  /** Family side ('Spoorthi', 'Parsh', 'Both'). */
  familySide: string | null;
  /** Freeform custom tags. */
  customTags: string[];
}

// ---------------------------------------------------------------------------
// Market tag constants (mirrors backend Zod schemas)
// ---------------------------------------------------------------------------

export const EVENT_TAGS = [
  "Sangeet",
  "Haldi",
  "Baraat",
  "Wedding Ceremony",
  "Reception",
  "After Party",
  "General",
] as const;

export type EventTag = typeof EVENT_TAGS[number];

export const FAMILY_SIDES = ["Spoorthi", "Parsh", "Both"] as const;
export type FamilySide = typeof FAMILY_SIDES[number];

export interface RecentPurchase {
  id: string;
  outcomeId: string;
  outcomeLabel: string;
  shares: number;
  cost: number;
  avgPrice: number;
  priceBefore: number;
  priceAfter: number;
  /** Serialized as ISO string over HTTP */
  createdAt: string;
}

export interface MarketDetail extends MarketWithPrices {
  recentPurchases: RecentPurchase[];
}

// ---------------------------------------------------------------------------
// WebSocket event payloads (mirror backend/src/ws/broadcaster.ts)
// ---------------------------------------------------------------------------

export interface WsPriceUpdatePayload {
  marketId: string;
  prices: Array<{ outcomeId: string; priceCents: number }>;
  timestamp: number;
}

export interface WsPurchasePayload {
  marketId: string;
  outcomeLabel: string;
  dollarAmount: number;
  priceAfterCents: number;
  timestamp: number;
}

export interface WsMarketEventPayload {
  type: "created" | "resolved" | "paused" | "voided" | "opening_soon";
  marketId: string;
  question?: string;
  winningOutcomeId?: string;
  scheduledOpenAt?: number;
  timestamp: number;
}

export interface WsBalanceUpdatePayload {
  balanceCents: number;
  timestamp: number;
}

export interface WsMarketNotificationPayload {
  marketId: string;
  message: string;
  scheduledOpenAt?: number;
  timestamp: number;
}
