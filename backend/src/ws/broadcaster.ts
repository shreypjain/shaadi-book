/**
 * Broadcasting utilities — PRD §6.6
 *
 * All broadcast functions are debounced to a maximum of 2 emits/second
 * per channel (500 ms minimum gap).  Balance updates are private
 * (one recipient) so they bypass the throttle.
 */
import type { Server as SocketIOServer } from "socket.io";
import { WS_CHANNELS } from "./channels.js";

// ---------------------------------------------------------------------------
// Throttle state — last-emit timestamps keyed by channel name
// ---------------------------------------------------------------------------

const lastEmitTs = new Map<string, number>();

/** Returns true and updates the timestamp if the channel is clear to emit. */
function shouldEmit(channel: string): boolean {
  const now = Date.now();
  const last = lastEmitTs.get(channel) ?? 0;
  if (now - last < 500) return false;
  lastEmitTs.set(channel, now);
  return true;
}

/** Reset throttle state (used in tests to avoid cross-test leakage). */
export function resetThrottle(): void {
  lastEmitTs.clear();
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface PriceUpdate {
  /** outcome UUID */
  outcomeId: string;
  /** price in cents, e.g. 62 = $0.62 */
  priceCents: number;
}

export interface PurchaseEvent {
  /** Human-readable outcome label, e.g. "Yes" */
  outcomeLabel: string;
  /** Dollar amount paid — NOT in cents, consistent with PRD display */
  dollarAmount: number;
  /** Post-purchase price in cents */
  priceAfterCents: number;
  /** Display name of the bettor. Never includes userId or phone number. */
  userName: string | null;
}

export interface MarketEvent {
  type: "created" | "resolved" | "paused" | "voided" | "opening_soon";
  marketId: string;
  question?: string;
  winningOutcomeId?: string;
  /** ms since epoch — set when type = 'opening_soon' */
  scheduledOpenAt?: number;
}

export interface BalanceUpdate {
  /** Balance in cents */
  balanceCents: number;
}

export interface MarketNotification {
  marketId: string;
  message: string;
  /** ms since epoch — set for scheduled market countdown */
  scheduledOpenAt?: number;
}

// ---------------------------------------------------------------------------
// Broadcasters
// ---------------------------------------------------------------------------

/**
 * Emit updated prices for all outcomes in a market.
 * Throttled: max 2/sec per market channel.
 */
export function broadcastPriceUpdate(
  io: SocketIOServer,
  marketId: string,
  prices: PriceUpdate[]
): void {
  const channel = WS_CHANNELS.marketPrices(marketId);
  if (!shouldEmit(channel)) return;

  io.to(channel).emit("priceUpdate", {
    marketId,
    prices,
    timestamp: Date.now(),
  });
}

/**
 * Emit a named purchase event to a market's activity feed.
 * Includes the bettor's display name but never userId or phone number.
 * Throttled: max 2/sec per market channel.
 */
export function broadcastPurchase(
  io: SocketIOServer,
  marketId: string,
  event: PurchaseEvent
): void {
  const channel = WS_CHANNELS.marketActivity(marketId);
  if (!shouldEmit(channel)) return;

  io.to(channel).emit("purchase", {
    marketId,
    outcomeLabel: event.outcomeLabel,
    dollarAmount: event.dollarAmount,
    priceAfterCents: event.priceAfterCents,
    userName: event.userName,
    timestamp: Date.now(),
  });
}

/**
 * Emit a market lifecycle event to the global feed.
 * (new market, resolved, paused, voided, opening soon)
 * Throttled: max 2/sec on the markets:feed channel.
 */
export function broadcastMarketEvent(
  io: SocketIOServer,
  event: MarketEvent
): void {
  const channel = WS_CHANNELS.marketsFeed;
  if (!shouldEmit(channel)) return;

  io.to(channel).emit("marketEvent", { ...event, timestamp: Date.now() });
}

/**
 * Emit a balance update to a user's private channel.
 * Not throttled — balance updates are low-volume, point-to-point.
 */
export function broadcastBalanceUpdate(
  io: SocketIOServer,
  userId: string,
  balance: BalanceUpdate
): void {
  const channel = WS_CHANNELS.userBalance(userId);
  // No throttle: private channel, one recipient, low frequency.
  io.to(channel).emit("balanceUpdate", {
    balanceCents: balance.balanceCents,
    timestamp: Date.now(),
  });
}

/**
 * Emit a push notification for a new / upcoming market.
 * Throttled: max 2/sec on the markets:notify channel.
 */
export function broadcastMarketNotification(
  io: SocketIOServer,
  event: MarketNotification
): void {
  const channel = WS_CHANNELS.marketsNotify;
  if (!shouldEmit(channel)) return;

  io.to(channel).emit("marketNotification", { ...event, timestamp: Date.now() });
}
