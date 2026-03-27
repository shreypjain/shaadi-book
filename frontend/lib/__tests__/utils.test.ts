/**
 * utils.test.ts — Unit tests for frontend utility functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatPriceCents,
  formatPrice,
  formatDollars,
  formatShares,
  formatVolume,
  timeSince,
  msSince,
  isNewMarket,
  isLowActivity,
  outcomeColor,
} from "../utils";

// ---------------------------------------------------------------------------
// Price formatting
// ---------------------------------------------------------------------------

describe("formatPriceCents", () => {
  it("formats 62 cents as 62¢", () => {
    expect(formatPriceCents(62)).toBe("62¢");
  });

  it("formats 100 cents as $1.00", () => {
    expect(formatPriceCents(100)).toBe("$1.00");
  });

  it("formats 0 cents as $0.00", () => {
    expect(formatPriceCents(0)).toBe("$0.00");
  });

  it("rounds fractional cents", () => {
    expect(formatPriceCents(62.7)).toBe("63¢");
    expect(formatPriceCents(62.3)).toBe("62¢");
  });

  it("formats values > 100 as $1.00", () => {
    expect(formatPriceCents(105)).toBe("$1.00");
  });

  it("formats values < 0 as $0.00", () => {
    expect(formatPriceCents(-5)).toBe("$0.00");
  });
});

describe("formatPrice", () => {
  it("converts fractional 0–1 price to cents display", () => {
    expect(formatPrice(0.62)).toBe("62¢");
    expect(formatPrice(0.5)).toBe("50¢");
    expect(formatPrice(1)).toBe("$1.00");
    expect(formatPrice(0)).toBe("$0.00");
  });
});

describe("formatDollars", () => {
  it("formats with 2 decimal places", () => {
    expect(formatDollars(14.3)).toBe("$14.30");
    expect(formatDollars(10)).toBe("$10.00");
    expect(formatDollars(0)).toBe("$0.00");
    expect(formatDollars(50)).toBe("$50.00");
  });
});

describe("formatShares", () => {
  it("rounds to 2 decimal places", () => {
    expect(formatShares(14.3456)).toBe("14.35");
    expect(formatShares(10)).toBe("10.00");
    expect(formatShares(0.1)).toBe("0.10");
  });
});

describe("formatVolume", () => {
  it("formats small amounts without k suffix", () => {
    expect(formatVolume(0)).toBe("$0");
    expect(formatVolume(100)).toBe("$100");
    expect(formatVolume(999)).toBe("$999");
  });

  it("formats large amounts with k suffix", () => {
    expect(formatVolume(1000)).toBe("$1.0k");
    expect(formatVolume(1500)).toBe("$1.5k");
    expect(formatVolume(2500)).toBe("$2.5k");
  });
});

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

describe("timeSince", () => {
  let now: number;

  beforeEach(() => {
    now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for < 10 seconds ago", () => {
    const date = new Date(now - 5000);
    expect(timeSince(date)).toBe("just now");
  });

  it("returns seconds ago for 10–59 seconds", () => {
    const date = new Date(now - 30000);
    expect(timeSince(date)).toBe("30s ago");
  });

  it("returns minutes ago for 1–59 minutes", () => {
    const date = new Date(now - 2 * 60 * 1000);
    expect(timeSince(date)).toBe("2 min ago");
  });

  it("returns hours ago for 1–23 hours", () => {
    const date = new Date(now - 3 * 60 * 60 * 1000);
    expect(timeSince(date)).toBe("3 hr ago");
  });

  it("returns days ago for >= 24 hours", () => {
    const date = new Date(now - 2 * 24 * 60 * 60 * 1000);
    expect(timeSince(date)).toBe("2d ago");
  });
});

describe("msSince", () => {
  it("returns elapsed ms since a date", () => {
    const earlier = new Date(Date.now() - 5000);
    const elapsed = msSince(earlier);
    // Allow ±100ms for test execution time
    expect(elapsed).toBeGreaterThanOrEqual(4900);
    expect(elapsed).toBeLessThan(6000);
  });
});

// ---------------------------------------------------------------------------
// Market badge logic
// ---------------------------------------------------------------------------

describe("isNewMarket", () => {
  it("returns false for null openedAt", () => {
    expect(isNewMarket(null)).toBe(false);
  });

  it("returns true for market opened < 5 min ago", () => {
    const recent = new Date(Date.now() - 2 * 60 * 1000); // 2 min ago
    expect(isNewMarket(recent)).toBe(true);
  });

  it("returns false for market opened > 5 min ago", () => {
    const old = new Date(Date.now() - 6 * 60 * 1000); // 6 min ago
    expect(isNewMarket(old)).toBe(false);
  });

  it("boundary: exactly 5 minutes is not new", () => {
    const boundary = new Date(Date.now() - 5 * 60 * 1000);
    expect(isNewMarket(boundary)).toBe(false);
  });
});

describe("isLowActivity", () => {
  it("returns false for null openedAt", () => {
    expect(isLowActivity(null, null)).toBe(false);
  });

  it("returns false when market opened < 30 min ago with no purchases", () => {
    const recent = new Date(Date.now() - 10 * 60 * 1000);
    expect(isLowActivity(recent, null)).toBe(false);
  });

  it("returns true when market opened > 30 min ago with no purchases", () => {
    const old = new Date(Date.now() - 35 * 60 * 1000);
    expect(isLowActivity(old, null)).toBe(true);
  });

  it("returns true when last purchase > 30 min ago", () => {
    const openedAt = new Date(Date.now() - 60 * 60 * 1000);
    const lastPurchase = new Date(Date.now() - 35 * 60 * 1000);
    expect(isLowActivity(openedAt, lastPurchase)).toBe(true);
  });

  it("returns false when last purchase < 30 min ago", () => {
    const openedAt = new Date(Date.now() - 60 * 60 * 1000);
    const lastPurchase = new Date(Date.now() - 5 * 60 * 1000);
    expect(isLowActivity(openedAt, lastPurchase)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Outcome color palette
// ---------------------------------------------------------------------------

describe("outcomeColor", () => {
  it("returns a color object for index 0", () => {
    const c = outcomeColor(0);
    expect(c.bg).toBeDefined();
    expect(c.bar).toBeDefined();
    expect(c.text).toBeDefined();
    expect(c.light).toBeDefined();
  });

  it("wraps around for index > palette length", () => {
    // Palette has 5 entries: index 5 should wrap to index 0
    expect(outcomeColor(5).bg).toBe(outcomeColor(0).bg);
    expect(outcomeColor(7).bg).toBe(outcomeColor(2).bg);
  });

  it("returns distinct colors for first few outcomes", () => {
    expect(outcomeColor(0).bg).not.toBe(outcomeColor(1).bg);
    expect(outcomeColor(1).bg).not.toBe(outcomeColor(2).bg);
  });
});
