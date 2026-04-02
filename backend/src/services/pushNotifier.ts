/**
 * Web Push Notification Service
 *
 * Mirrors smsNotifier.ts but uses the Web Push API instead of Twilio.
 * Sends push notifications to all users with active push subscriptions.
 *
 * Functions:
 *   sendPushToAll          — broadcast push to all subscribed users
 *   notifyNewMarketPush    — fire-and-forget new-market alert
 *   sendPeriodicPushUpdate — build market-summary and push to all
 *   notifyMarketActivityPush — targeted push to watchers/holders
 *
 * Env vars required:
 *   VAPID_PUBLIC_KEY   — Base64-encoded VAPID public key
 *   VAPID_PRIVATE_KEY  — Base64-encoded VAPID private key
 */

import webpush from "web-push";
import { prisma } from "../db.js";
import { listMarkets } from "./marketService.js";
import type { MarketWithPrices } from "./marketService.js";

// ---------------------------------------------------------------------------
// VAPID setup (run once at import time)
// ---------------------------------------------------------------------------

const VAPID_PUBLIC = process.env["VAPID_PUBLIC_KEY"] ?? "";
const VAPID_PRIVATE = process.env["VAPID_PRIVATE_KEY"] ?? "";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(
    "mailto:admin@parshandspoorthi.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );
  console.log("[pushNotifier] VAPID keys configured");
} else {
  console.log("[pushNotifier] VAPID keys not set — push notifications disabled");
}

function isConfigured(): boolean {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

interface SubRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// ---------------------------------------------------------------------------
// sendPushToAll
// ---------------------------------------------------------------------------

/**
 * Send a push notification to ALL users with active subscriptions.
 * Expired/invalid subscriptions are automatically cleaned up.
 */
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!isConfigured()) return;

  let subs: SubRecord[];
  try {
    subs = await prisma.pushSubscription.findMany({
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  } catch (err) {
    console.error("[pushNotifier] Failed to fetch subscriptions:", err);
    return;
  }

  if (subs.length === 0) {
    console.log("[pushNotifier] No push subscriptions — nothing to send");
    return;
  }

  console.log(`[pushNotifier] Sending push to ${subs.length} subscriptions`);

  const jsonPayload = JSON.stringify(payload);
  let successCount = 0;
  let cleanedCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          jsonPayload
        );
        successCount++;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404 or 410 = subscription expired/unsubscribed — clean up
        if (statusCode === 404 || statusCode === 410) {
          try {
            await prisma.pushSubscription.delete({ where: { id: sub.id } });
            cleanedCount++;
          } catch {
            // ignore cleanup errors
          }
        } else {
          console.error(
            `[pushNotifier] Push failed for ${sub.endpoint.slice(0, 60)}...: ` +
              `status=${statusCode}`
          );
        }
      }
    })
  );

  console.log(
    `[pushNotifier] Push complete — ${successCount} delivered, ${cleanedCount} expired cleaned`
  );
}

// ---------------------------------------------------------------------------
// sendPushToUsers
// ---------------------------------------------------------------------------

/**
 * Send a push to specific users (by userId). Used for targeted notifications.
 */
async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  if (!isConfigured() || userIds.length === 0) return;

  let subs: SubRecord[];
  try {
    subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  } catch (err) {
    console.error("[pushNotifier] Failed to fetch user subscriptions:", err);
    return;
  }

  if (subs.length === 0) return;

  const jsonPayload = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          jsonPayload
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          try {
            await prisma.pushSubscription.delete({ where: { id: sub.id } });
          } catch {
            // ignore
          }
        }
      }
    })
  );
}

// ---------------------------------------------------------------------------
// notifyNewMarketPush
// ---------------------------------------------------------------------------

export function notifyNewMarketPush(question: string): void {
  void sendPushToAll({
    title: "New Market!",
    body: question,
    url: "/",
    tag: "new-market",
  }).catch((err) => {
    console.error("[pushNotifier] notifyNewMarketPush error:", err);
  });
}

// ---------------------------------------------------------------------------
// sendPeriodicPushUpdate
// ---------------------------------------------------------------------------

export async function sendPeriodicPushUpdate(): Promise<void> {
  if (!isConfigured()) return;

  let markets: MarketWithPrices[];
  try {
    markets = await listMarkets({ status: "ACTIVE" });
  } catch (err) {
    console.error("[pushNotifier] Failed to fetch active markets:", err);
    return;
  }

  if (markets.length === 0) return;

  const lines = markets.slice(0, 5).map((m) => {
    const prices = m.outcomes.map((o) => `${o.label} ${o.priceCents}c`).join(" | ");
    return `${m.question}: ${prices}`;
  });

  const extra = markets.length > 5 ? `\n...and ${markets.length - 5} more` : "";

  await sendPushToAll({
    title: "Shaadi Book Market Update",
    body: lines.join("\n") + extra,
    url: "/",
    tag: "market-update",
  });
}

// ---------------------------------------------------------------------------
// notifyMarketActivityPush
// ---------------------------------------------------------------------------

export function notifyMarketActivityPush(
  actorUserId: string,
  marketId: string,
  actorName: string,
  outcomeLabel: string,
  dollarAmount: number
): void {
  void (async () => {
    if (!isConfigured()) return;

    let marketQuestion: string;
    try {
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        select: { question: true },
      });
      if (!market) return;
      marketQuestion = market.question;
    } catch {
      return;
    }

    // Find watchers + position holders, exclude actor
    let recipientIds: string[];
    try {
      const [watchers, positionHolders] = await Promise.all([
        prisma.marketWatch.findMany({
          where: { marketId },
          select: { userId: true },
        }),
        prisma.position.findMany({
          where: { marketId },
          select: { userId: true },
          distinct: ["userId"],
        }),
      ]);

      const allIds = new Set([
        ...watchers.map((w: { userId: string }) => w.userId),
        ...positionHolders.map((p: { userId: string }) => p.userId),
      ]);
      allIds.delete(actorUserId);
      recipientIds = Array.from(allIds);
    } catch {
      return;
    }

    if (recipientIds.length === 0) return;

    const amountStr =
      dollarAmount % 1 === 0
        ? `$${dollarAmount.toFixed(0)}`
        : `$${dollarAmount.toFixed(2)}`;

    await sendPushToUsers(recipientIds, {
      title: `${actorName} bet ${amountStr}`,
      body: `"${outcomeLabel}" in "${marketQuestion}"`,
      url: `/markets/${marketId}`,
      tag: `activity-${marketId}`,
    });
  })().catch((err) => {
    console.error("[pushNotifier] notifyMarketActivityPush error:", err);
  });
}

// ---------------------------------------------------------------------------
// startPeriodicPushUpdates
// ---------------------------------------------------------------------------

export function startPeriodicPushUpdates(intervalMs: number): void {
  if (!isConfigured()) return;

  const hours = (intervalMs / 3_600_000).toFixed(1);
  console.log(`[pushNotifier] Periodic push updates started — interval: ${hours}h`);

  // First update 60s after startup
  setTimeout(() => {
    void sendPeriodicPushUpdate().catch((err) => {
      console.error("[pushNotifier] periodic push (initial) error:", err);
    });
  }, 60_000);

  setInterval(() => {
    void sendPeriodicPushUpdate().catch((err) => {
      console.error("[pushNotifier] periodic push error:", err);
    });
  }, intervalMs);
}
