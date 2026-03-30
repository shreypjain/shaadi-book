/**
 * Price Snapshot Service
 *
 * Records periodic price snapshots used by the chart history feature.
 * Two write paths:
 *   1. `recordPurchaseSnapshots` — called fire-and-forget from purchaseEngine
 *      immediately after a trade settles.
 *   2. `snapshotAllActiveMarkets` — called by the 60-second background job so
 *      charts stay populated even when no trades occur.
 *
 * Rows older than 48 h are cleaned up once per day by `cleanupOldSnapshots`.
 */

import { prisma } from "../db.js";
import { defaultB, allPrices } from "./lmsr.js";
import { toNumber } from "./purchaseEngine.js";

// ---------------------------------------------------------------------------
// 1. Record snapshots immediately after a purchase
// ---------------------------------------------------------------------------

/**
 * Persist one snapshot row per outcome using the post-trade prices that the
 * purchase engine already computed.  Fire-and-forget — never throws.
 */
export async function recordPurchaseSnapshots(
  marketId: string,
  outcomeIds: string[],
  allNewPrices: number[]
): Promise<void> {
  await prisma.priceSnapshot.createMany({
    data: outcomeIds.map((outcomeId, i) => ({
      marketId,
      outcomeId,
      priceCents: Math.round((allNewPrices[i] ?? 0) * 100),
    })),
  });
}

// ---------------------------------------------------------------------------
// 2. Snapshot a single market (used by the background job)
// ---------------------------------------------------------------------------

/**
 * Compute the current LMSR prices for every outcome in a market and write
 * one snapshot row per outcome.  Silently skips non-ACTIVE markets.
 */
export async function snapshotMarketPrices(marketId: string): Promise<void> {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      outcomes: { orderBy: { position: "asc" } },
    },
  });

  if (!market || market.status !== "ACTIVE") return;

  // Use bParameter if set, otherwise defaultB with the market's maxSharesPerOutcome.
  const maxShares = toNumber((market as Record<string, unknown>).maxSharesPerOutcome ?? 1000);
  const bParam = (market as Record<string, unknown>).bParameter;
  const b = bParam != null ? toNumber(bParam) : defaultB(market.outcomes.length, maxShares);

  const q = (market.outcomes as Array<{ sharesSold: unknown }>).map((o) =>
    toNumber(o.sharesSold)
  );
  const prices = q.length >= 2 ? allPrices(q, b) : q.map(() => 0);

  await prisma.priceSnapshot.createMany({
    data: (market.outcomes as Array<{ id: string }>).map((o, i) => ({
      marketId,
      outcomeId: o.id,
      priceCents: Math.round((prices[i] ?? 0) * 100),
    })),
  });
}

// ---------------------------------------------------------------------------
// 3. Snapshot all ACTIVE markets (background job)
// ---------------------------------------------------------------------------

/**
 * Iterate over every ACTIVE market and snapshot its current prices.
 * Per-market errors are caught and logged so one bad market can't block the rest.
 */
export async function snapshotAllActiveMarkets(): Promise<void> {
  const markets = await prisma.market.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  const results = await Promise.allSettled(
    markets.map((m: { id: string }) => snapshotMarketPrices(m.id))
  );

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.warn(
        `[priceSnapshot] Failed to snapshot market ${markets[i]?.id}:`,
        r.reason
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 4. Cleanup
// ---------------------------------------------------------------------------

/**
 * Delete snapshot rows older than 48 hours.
 * Called once per day from the background job.
 */
export async function cleanupOldSnapshots(): Promise<void> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const result = await prisma.priceSnapshot.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    console.log(`[priceSnapshot] Cleaned up ${result.count} stale snapshot rows`);
  }
}

// ---------------------------------------------------------------------------
// 5. Background job starter
// ---------------------------------------------------------------------------

/**
 * Start the periodic snapshot job.
 * - Runs `snapshotAllActiveMarkets` every `intervalMs` (default 60 s).
 * - Runs `cleanupOldSnapshots` once every 24 h.
 *
 * Returns the interval handle so the caller can cancel it in tests.
 */
export function startPriceSnapshotJob(intervalMs = 60_000): ReturnType<typeof setInterval> {
  console.log(
    `[priceSnapshot] Starting snapshot job (interval: ${intervalMs / 1000}s)`
  );

  let lastCleanup = 0;

  return setInterval(() => {
    void (async () => {
      try {
        await snapshotAllActiveMarkets();
      } catch (err) {
        console.warn("[priceSnapshot] Snapshot run failed:", err);
      }

      // Daily cleanup
      if (Date.now() - lastCleanup > 24 * 60 * 60 * 1000) {
        try {
          await cleanupOldSnapshots();
          lastCleanup = Date.now();
        } catch (err) {
          console.warn("[priceSnapshot] Cleanup failed:", err);
        }
      }
    })();
  }, intervalMs);
}
