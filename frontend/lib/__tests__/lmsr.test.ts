/**
 * lmsr.test.ts — Unit tests for client-side LMSR math.
 */

import { describe, it, expect } from "vitest";
import { costFunction, price, allPrices, adaptiveB, computePreview } from "../lmsr";

// ---------------------------------------------------------------------------
// costFunction
// ---------------------------------------------------------------------------

describe("costFunction", () => {
  it("throws for empty q", () => {
    expect(() => costFunction([], 20)).toThrow("non-empty");
  });

  it("throws for non-positive b", () => {
    expect(() => costFunction([0, 0], 0)).toThrow("positive");
    expect(() => costFunction([0, 0], -1)).toThrow("positive");
  });

  it("returns b × ln(n) for equal zero shares (binary market)", () => {
    // C([0,0], b) = b × ln(e^0 + e^0) = b × ln(2)
    const b = 20;
    const result = costFunction([0, 0], b);
    expect(result).toBeCloseTo(b * Math.log(2), 5);
  });

  it("is monotonically increasing as shares increase", () => {
    const b = 20;
    const c0 = costFunction([0, 0], b);
    const c1 = costFunction([10, 0], b);
    const c2 = costFunction([20, 0], b);
    expect(c1).toBeGreaterThan(c0);
    expect(c2).toBeGreaterThan(c1);
  });

  it("is symmetric: adding shares to outcome 0 or 1 increases cost equally from start", () => {
    const b = 20;
    const delta = 5;
    const c_add0 = costFunction([delta, 0], b);
    const c_add1 = costFunction([0, delta], b);
    expect(c_add0).toBeCloseTo(c_add1, 5);
  });
});

// ---------------------------------------------------------------------------
// price
// ---------------------------------------------------------------------------

describe("price", () => {
  it("binary market at [0,0] has equal prices of 0.5", () => {
    const b = 20;
    expect(price([0, 0], b, 0)).toBeCloseTo(0.5, 5);
    expect(price([0, 0], b, 1)).toBeCloseTo(0.5, 5);
  });

  it("prices sum to 1 after trading", () => {
    const q = [10, 5, 3];
    const b = 20;
    const p0 = price(q, b, 0);
    const p1 = price(q, b, 1);
    const p2 = price(q, b, 2);
    expect(p0 + p1 + p2).toBeCloseTo(1, 5);
  });

  it("buying more shares increases the price of that outcome", () => {
    const b = 20;
    const pBefore = price([0, 0], b, 0);
    const pAfter = price([20, 0], b, 0);
    expect(pAfter).toBeGreaterThan(pBefore);
  });
});

// ---------------------------------------------------------------------------
// allPrices
// ---------------------------------------------------------------------------

describe("allPrices", () => {
  it("returns correct number of prices", () => {
    const q = [0, 0, 0];
    const prices = allPrices(q, 20);
    expect(prices).toHaveLength(3);
  });

  it("prices always sum to 1", () => {
    const cases: [number[], number][] = [
      [[0, 0], 20],
      [[10, 5], 20],
      [[100, 50, 25], 50],
      [[0, 0, 0, 0, 0], 20],
    ];
    for (const [q, b] of cases) {
      const prices = allPrices(q, b);
      const sum = prices.reduce((a, x) => a + x, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("equal shares give equal prices", () => {
    const prices = allPrices([0, 0, 0], 20);
    expect(prices[0]).toBeCloseTo(1 / 3, 5);
    expect(prices[1]).toBeCloseTo(1 / 3, 5);
    expect(prices[2]).toBeCloseTo(1 / 3, 5);
  });
});

// ---------------------------------------------------------------------------
// adaptiveB
// ---------------------------------------------------------------------------

describe("adaptiveB", () => {
  it("returns b_floor when formula gives less", () => {
    // With dt=0 and V=0, formula = 20 + 0 + 0 = 20 → max(b_floor, 20) = max(20, 20) = 20
    const result = adaptiveB(20, 0, 0);
    expect(result).toBe(20);
  });

  it("grows with time", () => {
    const b0 = adaptiveB(20, 0, 0);
    const b1 = adaptiveB(20, 60000, 0); // 1 minute
    const b2 = adaptiveB(20, 300000, 0); // 5 minutes
    expect(b1).toBeGreaterThan(b0);
    expect(b2).toBeGreaterThan(b1);
  });

  it("grows with volume", () => {
    const b0 = adaptiveB(20, 0, 0);
    const b1 = adaptiveB(20, 0, 100); // $100 volume
    const b2 = adaptiveB(20, 0, 500); // $500 volume
    expect(b1).toBeGreaterThan(b0);
    expect(b2).toBeGreaterThan(b1);
  });

  it("matches formula-computed values", () => {
    // b(0, 0) = max(20, 20 + 0 + 0) = 20
    expect(adaptiveB(20, 0, 0)).toBeCloseTo(20, 5);
    // b(30s, $0) = 20 + 0.6×0.25×√30000 ≈ 20 + 25.98 = 45.98
    expect(adaptiveB(20, 30_000, 0)).toBeCloseTo(45.98, 1);
    // b(5min, $500) = 20 + 0.6×0.25×√300000 + 0.4×0.5×500
    //              = 20 + 82.16 + 100 = 202.16
    expect(adaptiveB(20, 5 * 60 * 1000, 500)).toBeCloseTo(202.16, 1);
    // b(30min, $2000) = 20 + 0.6×0.25×√1800000 + 0.4×0.5×2000
    //                 = 20 + 201.25 + 400 = 621.25
    expect(adaptiveB(20, 30 * 60 * 1000, 2000)).toBeCloseTo(621.25, 0);
  });

  it("respects custom b_floor", () => {
    const result = adaptiveB(50, 0, 0);
    expect(result).toBe(50); // formula gives 20, but floor is 50
  });
});

// ---------------------------------------------------------------------------
// computePreview
// ---------------------------------------------------------------------------

describe("computePreview", () => {
  it("returns correct structure", () => {
    const result = computePreview([0, 0], 20, 0, 10);
    expect(result).toHaveProperty("shares");
    expect(result).toHaveProperty("avgPrice");
    expect(result).toHaveProperty("priceBefore");
    expect(result).toHaveProperty("priceAfter");
    expect(result).toHaveProperty("allPricesAfter");
    expect(result.allPricesAfter).toHaveLength(2);
  });

  it("cost of purchase ≈ dollarAmount", () => {
    // This verifies the binary search converged correctly
    const { shares, avgPrice } = computePreview([0, 0], 20, 0, 10);
    // shares × avgPrice ≈ dollarAmount
    expect(shares * avgPrice).toBeCloseTo(10, 2);
  });

  it("priceAfter > priceBefore (buying increases price)", () => {
    const { priceBefore, priceAfter } = computePreview([0, 0], 20, 0, 10);
    expect(priceAfter).toBeGreaterThan(priceBefore);
  });

  it("allPricesAfter sum to ~1", () => {
    const { allPricesAfter } = computePreview([0, 0], 20, 0, 10);
    const sum = allPricesAfter.reduce((a, x) => a + x, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it("larger purchase → more price impact", () => {
    const small = computePreview([0, 0], 20, 0, 5);
    const large = computePreview([0, 0], 20, 0, 30);
    const smallImpact = small.priceAfter - small.priceBefore;
    const largeImpact = large.priceAfter - large.priceBefore;
    expect(largeImpact).toBeGreaterThan(smallImpact);
  });

  it("higher b → less price impact for same purchase", () => {
    const lowB = computePreview([0, 0], 20, 0, 10);
    const highB = computePreview([0, 0], 200, 0, 10);
    const impactLow = lowB.priceAfter - lowB.priceBefore;
    const impactHigh = highB.priceAfter - highB.priceBefore;
    expect(impactHigh).toBeLessThan(impactLow);
  });

  it("handles 5-outcome market", () => {
    const q = [0, 0, 0, 0, 0];
    const result = computePreview(q, 50, 2, 25);
    expect(result.allPricesAfter).toHaveLength(5);
    const sum = result.allPricesAfter.reduce((a, x) => a + x, 0);
    expect(sum).toBeCloseTo(1, 4);
  });
});
