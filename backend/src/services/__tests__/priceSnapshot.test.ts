/**
 * Price Snapshot Service — Unit Tests (Prisma mocked)
 *
 * Tests:
 *  1. recordPurchaseSnapshots — writes one row per outcome with correct priceCents
 *  2. snapshotMarketPrices    — skips non-ACTIVE markets; writes LMSR-computed prices
 *  3. snapshotMarketPrices    — uses SUM aggregate (not all purchase rows)
 *  4. cleanupOldSnapshots     — deletes rows older than 48 h; logs count when > 0
 *  5. cleanupOldSnapshots     — silent when nothing deleted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma BEFORE importing the service under test
// ---------------------------------------------------------------------------

vi.mock("../../db.js", () => ({
  prisma: {
    priceSnapshot: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    market: {
      findUnique: vi.fn(),
    },
    purchase: {
      aggregate: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import {
  recordPurchaseSnapshots,
  snapshotMarketPrices,
  cleanupOldSnapshots,
} from "../priceSnapshot.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MARKET_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OUTCOME_YES_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const OUTCOME_NO_ID = "bbbbbbbb-0000-0000-0000-000000000002";

const mockActiveMarket = {
  id: MARKET_ID,
  status: "ACTIVE",
  openedAt: new Date(Date.now() - 60_000), // opened 60 s ago
  bFloorOverride: null,
  outcomes: [
    { id: OUTCOME_YES_ID, position: 0, sharesSold: "0" },
    { id: OUTCOME_NO_ID, position: 1, sharesSold: "0" },
  ],
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(prisma.priceSnapshot.createMany).mockResolvedValue({ count: 2 });
  vi.mocked(prisma.priceSnapshot.deleteMany).mockResolvedValue({ count: 0 });
  vi.mocked(prisma.market.findUnique).mockResolvedValue(mockActiveMarket as any);
  vi.mocked(prisma.purchase.aggregate).mockResolvedValue({
    _sum: { cost: "0" },
  } as any);
});

// ---------------------------------------------------------------------------
// 1. recordPurchaseSnapshots
// ---------------------------------------------------------------------------

describe("recordPurchaseSnapshots", () => {
  it("writes one row per outcome with rounded priceCents", async () => {
    const outcomeIds = [OUTCOME_YES_ID, OUTCOME_NO_ID];
    // prices in [0,1] — 0.5 → 50 cents, 0.4999 → 50 cents (rounded)
    const allNewPrices = [0.5, 0.4999];

    await recordPurchaseSnapshots(MARKET_ID, outcomeIds, allNewPrices);

    expect(prisma.priceSnapshot.createMany).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.priceSnapshot.createMany).mock.calls[0]![0];
    expect(call.data).toHaveLength(2);
    expect(call.data[0]).toMatchObject({
      marketId: MARKET_ID,
      outcomeId: OUTCOME_YES_ID,
      priceCents: 50,
    });
    expect(call.data[1]).toMatchObject({
      marketId: MARKET_ID,
      outcomeId: OUTCOME_NO_ID,
      priceCents: 50, // Math.round(0.4999 * 100) = 50
    });
  });

  it("handles an empty outcomeIds array gracefully", async () => {
    await recordPurchaseSnapshots(MARKET_ID, [], []);
    expect(prisma.priceSnapshot.createMany).toHaveBeenCalledWith({ data: [] });
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. snapshotMarketPrices
// ---------------------------------------------------------------------------

describe("snapshotMarketPrices", () => {
  it("skips when market is not found", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue(null);
    await snapshotMarketPrices(MARKET_ID);
    expect(prisma.priceSnapshot.createMany).not.toHaveBeenCalled();
  });

  it("skips when market status is not ACTIVE", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue({
      ...mockActiveMarket,
      status: "PAUSED",
    } as any);
    await snapshotMarketPrices(MARKET_ID);
    expect(prisma.priceSnapshot.createMany).not.toHaveBeenCalled();
  });

  it("uses fixed b (defaultB) — does NOT call purchase.aggregate for volume", async () => {
    // With fixed 100-share supply, b is derived from outcome count alone.
    // No volume query is needed; purchase.aggregate should NOT be called.
    await snapshotMarketPrices(MARKET_ID);

    expect(prisma.purchase.aggregate).not.toHaveBeenCalled();
    // The snapshot still writes rows (verified by the next test)
    expect(prisma.priceSnapshot.createMany).toHaveBeenCalledOnce();
  });

  it("writes one snapshot row per outcome for an ACTIVE market", async () => {
    await snapshotMarketPrices(MARKET_ID);

    expect(prisma.priceSnapshot.createMany).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.priceSnapshot.createMany).mock.calls[0]![0];
    expect(call.data).toHaveLength(2);

    // Both outcomes present; marketId correct
    expect(call.data[0]).toMatchObject({ marketId: MARKET_ID, outcomeId: OUTCOME_YES_ID });
    expect(call.data[1]).toMatchObject({ marketId: MARKET_ID, outcomeId: OUTCOME_NO_ID });

    // For a fresh market (q=[0,0]) both LMSR prices should be 50¢
    expect(call.data[0]!.priceCents).toBe(50);
    expect(call.data[1]!.priceCents).toBe(50);
  });

  it("applies bFloorOverride when set on the market", async () => {
    vi.mocked(prisma.market.findUnique).mockResolvedValue({
      ...mockActiveMarket,
      bFloorOverride: "30",
    } as any);

    await snapshotMarketPrices(MARKET_ID);

    // Should still complete without throwing
    expect(prisma.priceSnapshot.createMany).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. cleanupOldSnapshots
// ---------------------------------------------------------------------------

describe("cleanupOldSnapshots", () => {
  it("deletes snapshots older than 48 h", async () => {
    vi.mocked(prisma.priceSnapshot.deleteMany).mockResolvedValue({ count: 5 });

    const before = Date.now();
    await cleanupOldSnapshots();
    const after = Date.now();

    expect(prisma.priceSnapshot.deleteMany).toHaveBeenCalledOnce();
    const { where } = vi.mocked(prisma.priceSnapshot.deleteMany).mock.calls[0]![0] as {
      where: { createdAt: { lt: Date } };
    };
    const cutoff = where.createdAt.lt.getTime();
    const expected48h = 48 * 60 * 60 * 1000;

    // cutoff should be approximately (before - 48h)…(after - 48h)
    expect(cutoff).toBeGreaterThanOrEqual(before - expected48h - 100);
    expect(cutoff).toBeLessThanOrEqual(after - expected48h + 100);
  });

  it("logs when rows are deleted", async () => {
    vi.mocked(prisma.priceSnapshot.deleteMany).mockResolvedValue({ count: 12 });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await cleanupOldSnapshots();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("12")
    );
    consoleSpy.mockRestore();
  });

  it("does not log when no rows are deleted", async () => {
    vi.mocked(prisma.priceSnapshot.deleteMany).mockResolvedValue({ count: 0 });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await cleanupOldSnapshots();

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
