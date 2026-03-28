/**
 * WebSocket channel name templates — PRD §6.6
 *
 * Keep these in one place so producers (broadcaster) and consumers
 * (frontend, tests) always agree on the exact string.
 */
export const WS_CHANNELS = {
  /** Per-market price feed — updated on every purchase (max 2/sec) */
  marketPrices: (marketId: string) => `market:${marketId}:prices`,

  /** Per-market activity feed — anonymised purchase events */
  marketActivity: (marketId: string) => `market:${marketId}:activity`,

  /** Global feed — new market created / resolved / opening soon */
  marketsFeed: "markets:feed" as const,

  /** Push notifications for new / scheduled markets */
  marketsNotify: "markets:notify" as const,

  /** Private per-user balance channel */
  userBalance: (userId: string) => `user:${userId}:balance`,
} as const;
