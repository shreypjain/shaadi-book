/**
 * Notification Service — Task 2.2
 *
 * Broadcasts market lifecycle events to connected clients via WebSocket and,
 * for new markets, sends an SMS to every registered user via Twilio.
 *
 * Twilio SMS is fire-and-forget: failures are logged but never throw so the
 * market operation itself is never blocked.
 *
 * References:
 *   PRD §4.5 — market notification flow
 *   PRD §6.6 — real-time update architecture
 */

import type { Server as SocketIOServer } from "socket.io";
import twilio from "twilio";
import { prisma } from "../db.js";
import {
  broadcastMarketEvent,
  broadcastMarketNotification,
} from "../ws/broadcaster.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the io singleton without throwing if WS isn't initialised (e.g. tests). */
function safeGetIO(): SocketIOServer | undefined {
  try {
    // Dynamic import via require-style to avoid circular dep at startup
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getIO } = require("../ws/index.js") as {
      getIO(): SocketIOServer;
    };
    return getIO();
  } catch {
    return undefined;
  }
}

/**
 * Send `message` to every registered phone number via Twilio SMS.
 * Gracefully degrades if Twilio credentials are absent (dev/test).
 */
async function sendSmsToAllUsers(message: string): Promise<void> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const fromPhone = process.env["TWILIO_PHONE_NUMBER"];

  if (!accountSid || !authToken || !fromPhone) {
    console.log(
      "[notificationService] Twilio not configured — skipping SMS broadcast"
    );
    return;
  }

  const client = twilio(accountSid, authToken);

  const users = (await prisma.user.findMany({ select: { phone: true } })) as Array<{ phone: string }>;

  const results = await Promise.allSettled(
    users.map((u: { phone: string }) =>
      client.messages.create({
        body: message,
        from: fromPhone,
        to: u.phone,
      })
    )
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.warn(
      `[notificationService] ${failed}/${users.length} SMS sends failed`
    );
  } else {
    console.log(
      `[notificationService] SMS broadcast sent to ${users.length} users`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NewMarketPayload {
  marketId: string;
  question: string;
  scheduledOpenAt?: Date | null;
}

/**
 * Notify all clients about a newly created market.
 *
 * Immediate market  → broadcasts "created" event + "new bet" SMS.
 * Scheduled market  → broadcasts "opening_soon" event + countdown SMS.
 *
 * @param payload - Market details
 * @param io      - Socket.io server (falls back to module singleton if omitted)
 */
export async function notifyNewMarket(
  payload: NewMarketPayload,
  io?: SocketIOServer
): Promise<void> {
  const socket = io ?? safeGetIO();
  const isScheduled =
    payload.scheduledOpenAt != null &&
    payload.scheduledOpenAt > new Date();

  if (socket) {
    // Always emit a "created" event on the global feed
    broadcastMarketEvent(socket, {
      type: "created",
      marketId: payload.marketId,
      question: payload.question,
      scheduledOpenAt: payload.scheduledOpenAt?.getTime(),
    });

    // Notify channel: immediate → new-market badge; scheduled → countdown
    if (isScheduled) {
      broadcastMarketNotification(socket, {
        marketId: payload.marketId,
        message: `New market opening soon: "${payload.question}"`,
        scheduledOpenAt: payload.scheduledOpenAt!.getTime(),
      });
    } else {
      broadcastMarketNotification(socket, {
        marketId: payload.marketId,
        message: `New bet just dropped: "${payload.question}"`,
      });
    }
  }

  // SMS: fire-and-forget, never blocks market creation
  void sendSmsToAllUsers(
    "New bet just dropped on Shaadi Book! Open the app to place your bet."
  ).catch((err: unknown) => {
    console.error("[notificationService] SMS bulk send error:", err);
  });
}

/**
 * Broadcast market resolution to all connected clients.
 *
 * @param marketId        - The resolved market's UUID
 * @param winningOutcomeId - UUID of the winning outcome
 * @param io              - Socket.io server (falls back to module singleton)
 */
export function notifyMarketResolved(
  marketId: string,
  winningOutcomeId: string,
  io?: SocketIOServer
): void {
  const socket = io ?? safeGetIO();
  if (!socket) return;

  broadcastMarketEvent(socket, {
    type: "resolved",
    marketId,
    winningOutcomeId,
  });
}

/**
 * Broadcast market pause to all connected clients.
 */
export function notifyMarketPaused(
  marketId: string,
  io?: SocketIOServer
): void {
  const socket = io ?? safeGetIO();
  if (!socket) return;
  broadcastMarketEvent(socket, { type: "paused", marketId });
}

/**
 * Broadcast market void to all connected clients.
 */
export function notifyMarketVoided(
  marketId: string,
  io?: SocketIOServer
): void {
  const socket = io ?? safeGetIO();
  if (!socket) return;
  broadcastMarketEvent(socket, { type: "voided", marketId });
}
