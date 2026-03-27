/**
 * socket.ts — Socket.io client singleton.
 *
 * Connects with JWT auth token. Provides typed subscribe/unsubscribe helpers
 * for market channels matching backend/src/ws/channels.ts.
 *
 * Usage:
 *   const socket = getSocket();
 *   const unsub = subscribeToMarket(marketId, { onPriceUpdate, onPurchase });
 *   return () => unsub();
 */

import { io, type Socket } from "socket.io-client";
import { getToken } from "./auth";
import type {
  WsPriceUpdatePayload,
  WsPurchasePayload,
  WsMarketEventPayload,
  WsBalanceUpdatePayload,
  WsMarketNotificationPayload,
} from "./api-types";

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let _socket: Socket | null = null;

const WS_URL =
  typeof window !== "undefined"
    ? (process.env["NEXT_PUBLIC_WS_URL"] ?? "http://localhost:3001")
    : "http://localhost:3001";

/**
 * Return the singleton Socket.io client, creating it on first call.
 * The socket connects lazily — call `ensureConnected()` to force connection.
 */
export function getSocket(): Socket {
  if (_socket) return _socket;

  _socket = io(WS_URL, {
    autoConnect: false,
    auth: (cb) => {
      // Token may change (login/logout) so resolve it fresh each handshake.
      cb({ token: getToken() ?? "" });
    },
    transports: ["websocket"],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return _socket;
}

/**
 * Connect (or reconnect) the socket. Safe to call multiple times.
 */
export function ensureConnected(): void {
  const socket = getSocket();
  if (!socket.connected) {
    socket.connect();
  }
}

/**
 * Disconnect and destroy the socket singleton.
 * Call on logout or when the app unmounts.
 */
export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

// ---------------------------------------------------------------------------
// Channel name helpers (mirrors backend/src/ws/channels.ts)
// ---------------------------------------------------------------------------

export const WS_CHANNELS = {
  marketPrices: (marketId: string) => `market:${marketId}:prices`,
  marketActivity: (marketId: string) => `market:${marketId}:activity`,
  marketsFeed: "markets:feed" as const,
  marketsNotify: "markets:notify" as const,
  userBalance: (userId: string) => `user:${userId}:balance`,
} as const;

// ---------------------------------------------------------------------------
// Typed subscription helpers
// ---------------------------------------------------------------------------

export interface MarketSubscriptionHandlers {
  onPriceUpdate?: (payload: WsPriceUpdatePayload) => void;
  onPurchase?: (payload: WsPurchasePayload) => void;
}

/**
 * Subscribe to price updates and purchase activity for a market.
 * Joins the socket.io rooms by emitting "subscribe" events.
 * Returns an unsubscribe function.
 */
export function subscribeToMarket(
  marketId: string,
  handlers: MarketSubscriptionHandlers
): () => void {
  const socket = getSocket();

  const priceChannel = WS_CHANNELS.marketPrices(marketId);
  const activityChannel = WS_CHANNELS.marketActivity(marketId);

  // Join rooms
  socket.emit("subscribe", priceChannel);
  socket.emit("subscribe", activityChannel);

  // Attach handlers
  if (handlers.onPriceUpdate) {
    socket.on("priceUpdate", handlers.onPriceUpdate);
  }
  if (handlers.onPurchase) {
    socket.on("purchase", handlers.onPurchase);
  }

  return () => {
    socket.emit("unsubscribe", priceChannel);
    socket.emit("unsubscribe", activityChannel);
    if (handlers.onPriceUpdate) socket.off("priceUpdate", handlers.onPriceUpdate);
    if (handlers.onPurchase) socket.off("purchase", handlers.onPurchase);
  };
}

/**
 * Subscribe to the global market feed (new markets, resolutions, etc.).
 * Returns an unsubscribe function.
 */
export function subscribeToFeed(
  onMarketEvent: (payload: WsMarketEventPayload) => void,
  onNotification?: (payload: WsMarketNotificationPayload) => void
): () => void {
  const socket = getSocket();

  socket.emit("subscribe", WS_CHANNELS.marketsFeed);
  socket.emit("subscribe", WS_CHANNELS.marketsNotify);

  socket.on("marketEvent", onMarketEvent);
  if (onNotification) socket.on("marketNotification", onNotification);

  return () => {
    socket.emit("unsubscribe", WS_CHANNELS.marketsFeed);
    socket.emit("unsubscribe", WS_CHANNELS.marketsNotify);
    socket.off("marketEvent", onMarketEvent);
    if (onNotification) socket.off("marketNotification", onNotification);
  };
}

/**
 * Subscribe to a user's private balance channel.
 * Returns an unsubscribe function.
 */
export function subscribeToBalance(
  userId: string,
  onBalanceUpdate: (payload: WsBalanceUpdatePayload) => void
): () => void {
  const socket = getSocket();
  const channel = WS_CHANNELS.userBalance(userId);

  socket.emit("subscribe", channel);
  socket.on("balanceUpdate", onBalanceUpdate);

  return () => {
    socket.emit("unsubscribe", channel);
    socket.off("balanceUpdate", onBalanceUpdate);
  };
}
