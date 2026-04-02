/**
 * SMS Notifier Service
 *
 * Handles outbound SMS notifications to all registered users via the
 * Twilio Messages API (NOT Twilio Verify — that is OTP-only).
 *
 * Functions:
 *   sendSmsToAll          — rate-limited batch send (~1 msg/sec)
 *   notifyNewMarket       — fire-and-forget new-market alert
 *   sendPeriodicUpdate    — build market-summary message and send to all users
 *   startPeriodicNotifications — setInterval wrapper (call after server start)
 *
 * Rate limiting: we send one message per second via a sequential loop + sleep
 * to avoid hitting Twilio's default 1 msg/sec throughput cap.
 *
 * Twilio env vars required:
 *   TWILIO_ACCOUNT_SID   — Twilio account SID
 *   TWILIO_AUTH_TOKEN    — Twilio auth token
 *   TWILIO_PHONE_NUMBER  — Outbound number in E.164 format (+14788127434)
 *
 * When those vars are absent (tests, local dev) all functions are no-ops.
 */

import twilio from "twilio";
import { prisma } from "../db.js";
import { listMarkets } from "./marketService.js";
import type { MarketWithPrices } from "./marketService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Filter out fake/test phone numbers that will always fail. */
function isRealPhone(phone: string): boolean {
  // Filter +1000000000X pattern (test seeds) and obviously invalid numbers
  return !phone.startsWith("+100000");
}

/**
 * Pick the best outbound number for a given recipient.
 *
 * Uses TWILIO_TOLLFREE_NUMBER (if set) for US numbers — toll-free has
 * much better A2P deliverability than local numbers on US carriers.
 * Falls back to TWILIO_PHONE_NUMBER for non-US or if toll-free is unset.
 */
function pickFromNumber(toPhone: string): string {
  const tollFree = process.env["TWILIO_TOLLFREE_NUMBER"];
  const local = process.env["TWILIO_PHONE_NUMBER"] ?? "";

  if (tollFree && toPhone.startsWith("+1")) {
    return tollFree;
  }
  return local;
}

// ---------------------------------------------------------------------------
// sendSmsToAll
// ---------------------------------------------------------------------------

/**
 * Send `message` to every registered user via Twilio Messages API.
 *
 * Rate limited to ~1 msg/sec.  Individual send failures are caught and
 * logged so a bad number never aborts the rest of the batch.
 *
 * Skips fake/test phone numbers. Uses toll-free number for US recipients
 * when TWILIO_TOLLFREE_NUMBER is set (better carrier deliverability).
 */
export async function sendSmsToAll(message: string): Promise<void> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const fromPhone = process.env["TWILIO_PHONE_NUMBER"];

  if (!accountSid || !authToken || !fromPhone) {
    console.log("[smsNotifier] Twilio env vars not configured — skipping SMS send");
    return;
  }

  let allUsers: Array<{ phone: string }>;
  try {
    allUsers = await prisma.user.findMany({ select: { phone: true } });
  } catch (err) {
    console.error("[smsNotifier] Failed to fetch users for SMS batch:", err);
    return;
  }

  // Filter out fake/test phone numbers
  const users = allUsers.filter((u) => isRealPhone(u.phone));
  const skipped = allUsers.length - users.length;

  if (users.length === 0) {
    console.log("[smsNotifier] No real registered users — nothing to send");
    return;
  }

  console.log(
    `[smsNotifier] Starting SMS batch to ${users.length} users` +
      (skipped > 0 ? ` (${skipped} fake numbers skipped)` : "")
  );

  const client = twilio(accountSid, authToken);
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i]!;
    const from = pickFromNumber(user.phone);
    try {
      const msg = await client.messages.create({
        to: user.phone,
        from,
        body: message,
      });
      successCount++;
      console.log(
        `[smsNotifier] Queued (${i + 1}/${users.length}) → ${user.phone} ` +
          `[sid=${msg.sid}, from=${from}]`
      );
    } catch (err: unknown) {
      failureCount++;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[smsNotifier] Failed to send to ${user.phone} [from=${from}]: ${errMsg}`
      );
    }

    // Rate limit: ~1 message per second (skip delay after the last item)
    if (i < users.length - 1) {
      await sleep(1000);
    }
  }

  console.log(
    `[smsNotifier] Batch complete — ${successCount} queued, ${failureCount} failed`
  );
}

// ---------------------------------------------------------------------------
// notifyNewMarket
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: notify all users about a newly created/opened market.
 *
 * Returns immediately so the API response is not blocked.
 * The SMS batch continues running in the background.
 */
export function notifyNewMarket(question: string): void {
  const message =
    `Shaadi Book | New market: "${question}" — Place your bet at markets.parshandspoorthi.com`;
  console.log(`[smsNotifier] New market notification queued: "${question}"`);

  void sendSmsToAll(message).catch((err) => {
    console.error("[smsNotifier] notifyNewMarket batch error:", err);
  });
}

// ---------------------------------------------------------------------------
// sendPeriodicUpdate
// ---------------------------------------------------------------------------

/**
 * Fetch all ACTIVE markets with current prices, build a summary SMS, and
 * send to all registered users.
 *
 * Message format:
 *   Shaadi Book | Market Update
 *
 *   • {question}: {outcome1} {price1}¢ | {outcome2} {price2}¢
 *   ...
 *   ...and X more   ← only when truncated to stay under 1 600 chars
 *
 *   Bet now: markets.parshandspoorthi.com
 */
export async function sendPeriodicUpdate(): Promise<void> {
  console.log("[smsNotifier] Periodic update cycle starting");

  let markets: MarketWithPrices[];
  try {
    markets = await listMarkets({ status: "ACTIVE" });
  } catch (err) {
    console.error("[smsNotifier] Failed to fetch active markets:", err);
    return;
  }

  if (markets.length === 0) {
    console.log("[smsNotifier] No active markets — skipping periodic SMS");
    return;
  }

  const header = "Shaadi Book | Market Update\n\n";
  const footer = "\nBet now: markets.parshandspoorthi.com";
  const MAX_SMS_LENGTH = 1600;

  let body = "";
  let includedCount = 0;

  for (const market of markets) {
    const priceParts = market.outcomes
      .map((o) => `${o.label} ${o.priceCents}¢`)
      .join(" | ");
    const line = `• ${market.question}: ${priceParts}\n`;

    // Check whether adding this line would exceed the SMS limit
    if ((header + body + line + footer).length > MAX_SMS_LENGTH) break;

    body += line;
    includedCount++;
  }

  const remaining = markets.length - includedCount;
  if (remaining > 0) {
    body += `...and ${remaining} more`;
  }

  const message = header + body + footer;

  console.log(
    `[smsNotifier] Periodic update: ${markets.length} active markets, ` +
      `${includedCount} included, message length ${message.length} chars`
  );

  await sendSmsToAll(message);
}

// ---------------------------------------------------------------------------
// notifyMarketActivity
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: notify all users watching this market OR holding positions in it
 * when a new bet is placed. Excludes the actor (the person who just bet).
 *
 * Rate limited to ~1 msg/sec.
 */
export function notifyMarketActivity(
  actorUserId: string,
  marketId: string,
  actorName: string,
  outcomeLabel: string,
  dollarAmount: number
): void {
  void (async () => {
    const accountSid = process.env["TWILIO_ACCOUNT_SID"];
    const authToken = process.env["TWILIO_AUTH_TOKEN"];
    const fromPhone = process.env["TWILIO_PHONE_NUMBER"];

    if (!accountSid || !authToken || !fromPhone) {
      console.log("[smsNotifier] Twilio env vars not configured — skipping notifyMarketActivity");
      return;
    }

    // Fetch market question for the message
    let marketQuestion: string;
    try {
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        select: { question: true },
      });
      if (!market) {
        console.warn("[smsNotifier] notifyMarketActivity: market not found:", marketId);
        return;
      }
      marketQuestion = market.question;
    } catch (err) {
      console.error("[smsNotifier] notifyMarketActivity: failed to fetch market:", err);
      return;
    }

    // Find all users watching this market OR holding positions in it
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
      // Exclude the actor
      allIds.delete(actorUserId);
      recipientIds = Array.from(allIds);
    } catch (err) {
      console.error("[smsNotifier] notifyMarketActivity: failed to fetch recipients:", err);
      return;
    }

    if (recipientIds.length === 0) {
      console.log("[smsNotifier] notifyMarketActivity: no recipients — skipping");
      return;
    }

    // Fetch phone numbers for recipients, filter out fake numbers
    let recipients: Array<{ phone: string }>;
    try {
      const allRecipients = await prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { phone: true },
      });
      recipients = allRecipients.filter((r) => isRealPhone(r.phone));
    } catch (err) {
      console.error("[smsNotifier] notifyMarketActivity: failed to fetch phones:", err);
      return;
    }

    if (recipients.length === 0) {
      console.log("[smsNotifier] notifyMarketActivity: no real recipients after filtering — skipping");
      return;
    }

    const amountStr = dollarAmount % 1 === 0
      ? `$${dollarAmount.toFixed(0)}`
      : `$${dollarAmount.toFixed(2)}`;
    const message =
      `Shaadi Book | ${actorName} just bet ${amountStr} on "${outcomeLabel}" in ` +
      `"${marketQuestion}". Check it out: markets.parshandspoorthi.com/markets/${marketId}`;

    console.log(
      `[smsNotifier] notifyMarketActivity: sending to ${recipients.length} recipients for market ${marketId}`
    );

    const client = twilio(accountSid, authToken);
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i]!;
      const from = pickFromNumber(recipient.phone);
      try {
        const msg = await client.messages.create({
          to: recipient.phone,
          from,
          body: message,
        });
        successCount++;
        console.log(
          `[smsNotifier] notifyMarketActivity: queued → ${recipient.phone} [sid=${msg.sid}, from=${from}]`
        );
      } catch (err: unknown) {
        failureCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[smsNotifier] notifyMarketActivity: failed to send to ${recipient.phone} [from=${from}]: ${errMsg}`
        );
      }

      // Rate limit: ~1 message per second
      if (i < recipients.length - 1) {
        await sleep(1000);
      }
    }

    console.log(
      `[smsNotifier] notifyMarketActivity complete — ${successCount} queued, ${failureCount} failed`
    );
  })().catch((err) => {
    console.error("[smsNotifier] notifyMarketActivity unhandled error:", err);
  });
}

// ---------------------------------------------------------------------------
// startPeriodicNotifications
// ---------------------------------------------------------------------------

/**
 * Start the periodic SMS notification job.
 *
 * Should be called once after the HTTP server begins listening.
 * Controlled by the ENABLE_SMS_NOTIFICATIONS env var in index.ts — this
 * function itself does not check that flag.
 *
 * Fires the first update 60 seconds after startup (so deploys don't wait
 * a full interval), then repeats on the given interval.
 *
 * @param intervalMs — Interval in ms (e.g. 5 * 60 * 60 * 1000 for 5 hours)
 */
export function startPeriodicNotifications(intervalMs: number): void {
  const hours = (intervalMs / 3_600_000).toFixed(1);
  console.log(
    `[smsNotifier] Periodic notifications started — interval: ${hours}h, first update in 60s`
  );

  // Fire first update 60s after startup so we don't wait a full interval
  setTimeout(() => {
    void sendPeriodicUpdate().catch((err) => {
      console.error("[smsNotifier] sendPeriodicUpdate (initial) error:", err);
    });
  }, 60_000);

  setInterval(() => {
    void sendPeriodicUpdate().catch((err) => {
      console.error("[smsNotifier] sendPeriodicUpdate unhandled error:", err);
    });
  }, intervalMs);
}
