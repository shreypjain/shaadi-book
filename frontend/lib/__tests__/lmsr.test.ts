/**
 * lmsr.test.ts — Unit tests for client-side LMSR math.
 */

import { describe, it, expect } from "vitest";
import { costFunction, price, allPrices, defaultB, computePreview, computeDollarAmountForShares } from "../lmsr";

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
// defaultB
// ---------------------------------------------------------------------------

describe("defaultB", () => {
  it("throws for fewer than 2 outcomes", () => {
    expect(() => defaultB(1)).toThrow("numOutcomes must be >= 2");
  });

  it("binary market with 100 shares ≈ 27.2", () => {
    // b = 0.8 × 100 / ln(19 × 1) ≈ 80 / ln(19) ≈ 27.17
    expect(defaultB(2, 100)).toBeCloseTo(27.17, 1);
  });

  it("defaults maxShares to 100", () => {
    expect(defaultB(2)).toBeCloseTo(defaultB(2, 100), 10);
  });

  it("scales with maxShares", () => {
    const b50 = defaultB(2, 50);
    const b100 = defaultB(2, 100);
    expect(b100).toBeCloseTo(b50 * 2, 5);
  });

  it("decreases as numOutcomes increases (more outcomes → smaller b for same maxShares)", () => {
    const b2 = defaultB(2, 100);
    const b3 = defaultB(3, 100);
    const b5 = defaultB(5, 100);
    expect(b3).toBeLessThan(b2);
    expect(b5).toBeLessThan(b3);
  });
});

// ---------------------------------------------------------------------------
// computeDollarAmountForShares
// ---------------------------------------------------------------------------

describe("computeDollarAmountForShares", () => {
  it("throws for sharesToSell <= 0", () => {
    expect(() => computeDollarAmountForShares([10, 10], 27, 0, 0)).toThrow();
    expect(() => computeDollarAmountForShares([10, 10], 27, 0, -1)).toThrow();
  });

  it("throws for outcomeIndex out of range", () => {
    expect(() => computeDollarAmountForShares([10, 10], 27, 2, 5)).toThrow();
  });

  it("throws if sharesToSell > qi", () => {
    expect(() => computeDollarAmountForShares([5, 10], 27, 0, 10)).toThrow();
  });

  it("returns positive revenue for valid sell", () => {
    const q = [50, 20];
    const b = defaultB(2, 100);
    const revenue = computeDollarAmountForShares(q, b, 0, 10);
    expect(revenue).toBeGreaterThan(0);
  });

  it("selling more shares yields more revenue", () => {
    const q = [60, 20];
    const b = defaultB(2, 100);
    const r5 = computeDollarAmountForShares(q, b, 0, 5);
    const r10 = computeDollarAmountForShares(q, b, 0, 10);
    expect(r10).toBeGreaterThan(r5);
  });

  it("revenue = C(before) - C(after)", () => {
    const q = [40, 30];
    const b = 27;
    const sharesToSell = 8;
    const before = costFunction(q, b);
    const qAfter = [32, 30];
    const after = costFunction(qAfter, b);
    const expected = Math.round((before - after) * 10_000) / 10_000;
    expect(computeDollarAmountForShares(q, b, 0, sharesToSell)).toBeCloseTo(expected, 4);
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
