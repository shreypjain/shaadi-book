/**
 * Notification Service — Task 2.2
 *
 * Handles market lifecycle notifications:
 *   - WebSocket broadcasts (markets:feed, markets:notify)
 *   - SMS to all registered users via Twilio (new market only)
 *   - Scheduled 5-minute countdown for scheduled markets
 *
 * All functions accept an optional Socket.io server so callers in tests
 * can pass undefined to skip WebSocket emissions.
 *
 * SMS is silently skipped when Twilio env vars are absent (test / local dev).
 *
 * References:
 *   PRD §4.5 — market notification flow
 *   PRD §6.6 — real-time update architecture
 */

import type { Server as SocketIOServer } from "socket.io";
import {
  broadcastMarketEvent,
  broadcastMarketNotification,
} from "../ws/broadcaster.js";
import { notifyNewMarket as smsSendNewMarket } from "./smsNotifier.js";
import { notifyNewMarketPush } from "./pushNotifier.js";

// ---------------------------------------------------------------------------
// Public notification functions
// ---------------------------------------------------------------------------

/**
 * Notify all clients + all registered users when a market is created.
 *
 * Immediate market:
 *   - WebSocket: broadcast "created" event on markets:feed
 *   - WebSocket: broadcast notification on markets:notify
 *   - SMS: send to all registered users
 *
 * The market CRUD service calls this after createMarket completes.
 */
export async function notifyNewMarket(
  market: { id: string; question: string },
  io?: SocketIOServer
): Promise<void> {
  // WebSocket broadcast
  if (io) {
    broadcastMarketEvent(io, {
      type: "created",
      marketId: market.id,
      question: market.question,
    });

    broadcastMarketNotification(io, {
      marketId: market.id,
      message: `New bet just dropped on Shaadi Book: "${market.question}"`,
    });
  }

  // SMS all registered users — fire-and-forget via smsNotifier (rate-limited, non-blocking)
  smsSendNewMarket(market.question);

  // Push notification to all subscribed browsers
  notifyNewMarketPush(market.question);
}

/**
 * Broadcast market resolution to all connected clients.
 */
export function notifyMarketResolved(
  market: {
    id: string;
    question?: string;
    winningOutcomeId: string | null;
  },
  io?: SocketIOServer
): void {
  if (!io) return;
  broadcastMarketEvent(io, {
    type: "resolved",
    marketId: market.id,
    question: market.question,
    winningOutcomeId: market.winningOutcomeId ?? undefined,
  });
}

/**
 * Set up timer-based notifications for a scheduled market:
 *   - 5 minutes before open: WebSocket push with countdown
 *   - At open time: openMarket() is called by the caller; this only broadcasts
 *
 * Returns a cleanup function that clears the timers (useful in tests).
 */
export function scheduleMarketOpen(
  market: {
    id: string;
    question: string;
    scheduledOpenAt: Date | null;
  },
  onOpen: () => Promise<void>,
  io?: SocketIOServer
): () => void {
  if (!market.scheduledOpenAt) return () => undefined;

  const openAtMs = market.scheduledOpenAt.getTime();
  const now = Date.now();
  const timers: ReturnType<typeof setTimeout>[] = [];

  // 5-minute countdown notification
  const fiveMinBeforeMs = openAtMs - 5 * 60 * 1000;
  const countdownDelay = fiveMinBeforeMs - now;

  if (countdownDelay > 0 && io) {
    const t = setTimeout(() => {
      broadcastMarketNotification(io, {
        marketId: market.id,
        message: `New market opening in 5 min: "${market.question}"`,
        scheduledOpenAt: openAtMs,
      });
    }, countdownDelay);
    timers.push(t);
  }

  // Open event
  const openDelay = openAtMs - now;
  if (openDelay > 0) {
    const t = setTimeout(async () => {
      try {
        await onOpen();
        if (io) {
          broadcastMarketEvent(io, {
            type: "created",
            marketId: market.id,
            question: market.question,
          });
        }
      } catch (err) {
        console.error(`[notifications] scheduleMarketOpen failed: ${err}`);
      }
    }, openDelay);
    timers.push(t);
  }

  // Return cleanup
  return () => timers.forEach(clearTimeout);
}


/**
 * Re-schedule all PENDING markets that have a scheduledOpenAt in the future.
 * Markets whose scheduledOpenAt has already passed are opened immediately.
 *
 * Must be called on server startup to recover from restarts (setTimeout is
 * in-memory and lost on process exit).
 */
export async function reschedulePendingMarkets(
  prisma: import("@prisma/client").PrismaClient,
  openMarketFn: (marketId: string) => Promise<void>,
  io?: SocketIOServer
): Promise<void> {
  const pendingMarkets = await prisma.market.findMany({
    where: { status: "PENDING", scheduledOpenAt: { not: null } },
    select: { id: true, question: true, scheduledOpenAt: true },
  });

  if (pendingMarkets.length === 0) {
    console.log("[scheduler] No pending scheduled markets to reschedule.");
    return;
  }

  const now = Date.now();

  for (const m of pendingMarkets) {
    if (!m.scheduledOpenAt) continue;

    if (m.scheduledOpenAt.getTime() <= now) {
      // Already past due — open immediately
      console.log(`[scheduler] Opening overdue market ${m.id}: "${m.question}"`);
      try {
        await openMarketFn(m.id);
        if (io) {
          broadcastMarketEvent(io, {
            type: "created",
            marketId: m.id,
            question: m.question,
          });
        }
      } catch (err) {
        console.error(`[scheduler] Failed to open overdue market ${m.id}:`, err);
      }
    } else {
      // Future — schedule timer
      console.log(
        `[scheduler] Rescheduling market ${m.id}: "${m.question}" → opens at ${m.scheduledOpenAt.toISOString()}`
      );
      scheduleMarketOpen(
        { id: m.id, question: m.question, scheduledOpenAt: m.scheduledOpenAt },
        async () => openMarketFn(m.id),
        io
      );
    }
  }

  console.log(`[scheduler] Rescheduled ${pendingMarkets.length} pending market(s).`);
}
