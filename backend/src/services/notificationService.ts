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

import twilio from "twilio";
import type { Server as SocketIOServer } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db.js";
import {
  broadcastMarketEvent,
  broadcastMarketNotification,
} from "../ws/broadcaster.js";

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
  io?: SocketIOServer,
  prismaClient?: PrismaClient
): Promise<void> {
  const db = prismaClient ?? defaultPrisma;

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

  // SMS all registered users — fire-and-forget, errors are logged not thrown
  await sendSmsToAll(
    "New bet just dropped on Shaadi Book! Open the app to place your bet.",
    db
  );
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Send an SMS to every registered user's phone. Errors are logged, not thrown. */
async function sendSmsToAll(body: string, db: PrismaClient): Promise<void> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const fromPhone = process.env["TWILIO_PHONE_NUMBER"];

  if (!accountSid || !authToken || !fromPhone) {
    // Twilio not configured — skip SMS (common in tests and local dev)
    return;
  }

  let users: Array<{ phone: string }>;
  try {
    users = await db.user.findMany({ select: { phone: true } });
  } catch (err) {
    console.error("[notifications] Failed to fetch users for SMS:", err);
    return;
  }

  if (users.length === 0) return;

  const client = twilio(accountSid, authToken);
  const results = await Promise.allSettled(
    users.map((u) =>
      client.messages.create({ to: u.phone, from: fromPhone, body })
    )
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.error(
      `[notifications] ${failures.length}/${users.length} SMS messages failed`
    );
  }
}
