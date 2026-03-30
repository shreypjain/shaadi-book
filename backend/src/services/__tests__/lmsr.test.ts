/**
 * LMSR Pricing Engine — Unit Tests
 *
 * Fixed 1000-share supply model with buying and selling.
 *
 * Coverage:
 *   1.  Prices sum to 1.0 for arbitrary (q, b)
 *   2.  Initial equal prices when q = [0, 0]
 *   3.  Cost function is monotonically increasing
 *   4.  computeSharesForDollarAmount — closed-form correctness
 *   5.  computeSharesForDollarAmount — closed-form matches binary-search reference
 *   6.  computeSharesForDollarAmount — SHARE_CAP_EXCEEDED guard
 *   7.  computeDollarAmountForShares — selling
 *   8.  Round-trip: buy then sell recovers original dollar amount
 *   9.  defaultB — calibration targets
 *   10. Edge cases
 *   11. Price impact examples
 *   12. Property test — 100 random (q, b) pairs
 */

import { describe, expect, it } from "vitest";
import {
  allPrices,
  computeDollarAmountForShares,
  computeSharesForDollarAmount,
  costFunction,
  defaultB,
  maxHouseExposure,
  price,
  priceAfterPurchase,
} from "../lmsr.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EPSILON = 0.0001; // tolerance for prices-sum-to-1 tests
const COST_TOL = 0.01; // tolerance for cost convergence

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/** Seeded deterministic "random" for reproducible property tests. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Reference binary-search implementation — used only to cross-validate the
 * closed-form solution.  NOT used in production.
 */
function binarySearchShares(
  q: number[],
  b: number,
  outcomeIndex: number,
  dollarAmount: number
): number {
  const cBefore = costFunction(q, b);
  const target = cBefore + dollarAmount;

  const costAtDelta = (delta: number): number => {
    const qNew = q.slice();
    qNew[outcomeIndex] = (q[outcomeIndex] ?? 0) + delta;
    return costFunction(qNew, b);
  };

  let lo = 0;
  let hi = Math.max(dollarAmount, 1);
  while (costAtDelta(hi) < target) hi *= 2;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(costAtDelta(mid) - target) < 1e-7) break;
    if (costAtDelta(mid) < target) lo = mid;
    else hi = mid;
  }

  return Math.round(((lo + hi) / 2) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// 1. Prices sum to 1.0
// ---------------------------------------------------------------------------

describe("allPrices — prices sum to 1.0", () => {
  const strictCases: Array<[number[], number]> = [
    [[0, 0], 20],
    [[10, 5], 20],
    [[100, -50], 20],
    [[0, 0, 0], 50],
    [[30, 10, 5, 2, 1], 100],
  ];

  for (const [q, b] of strictCases) {
    it(`q=${JSON.stringify(q)}, b=${b} — strictly (0,1)`, () => {
      const prices = allPrices(q, b);
      expect(prices).toHaveLength(q.length);
      expect(Math.abs(sum(prices) - 1.0)).toBeLessThan(EPSILON);
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    });
  }

  it("extreme dominance q=[1000,0], b=20 — sum=1, values in [0,1]", () => {
    const prices = allPrices([1000, 0], 20);
    expect(prices).toHaveLength(2);
    expect(Math.abs(sum(prices) - 1.0)).toBeLessThan(EPSILON);
    for (const p of prices) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(prices[0]).toBeGreaterThan(0.999);
  });

  it("extreme spread q=[-500,500], b=20 — sum=1, values in [0,1]", () => {
    const prices = allPrices([-500, 500], 20);
    expect(prices).toHaveLength(2);
    expect(Math.abs(sum(prices) - 1.0)).toBeLessThan(EPSILON);
    for (const p of prices) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(prices[1]).toBeGreaterThan(0.999);
  });
});

// ---------------------------------------------------------------------------
// 2. Initial prices equal when q = [0, 0]
// ---------------------------------------------------------------------------

describe("allPrices — initial equal prices", () => {
  it("binary market [0,0] → [0.50, 0.50]", () => {
    const prices = allPrices([0, 0], 20);
    expect(prices[0]).toBeCloseTo(0.5, 6);
    expect(prices[1]).toBeCloseTo(0.5, 6);
  });

  it("3-outcome market [0,0,0] → [1/3, 1/3, 1/3]", () => {
    const prices = allPrices([0, 0, 0], 20);
    for (const p of prices) {
      expect(p).toBeCloseTo(1 / 3, 6);
    }
  });

  it("5-outcome market [0,0,0,0,0] → [0.20, …]", () => {
    const prices = allPrices([0, 0, 0, 0, 0], 50);
    for (const p of prices) {
      expect(p).toBeCloseTo(0.2, 6);
    }
  });

  it("price() matches allPrices() element-wise", () => {
    const q = [10, 5, 2];
    const b = 30;
    const all = allPrices(q, b);
    for (let i = 0; i < q.length; i++) {
      expect(price(q, b, i)).toBeCloseTo(all[i]!, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Cost function monotonically increasing
// ---------------------------------------------------------------------------

describe("costFunction — monotonically increasing", () => {
  it("buying more shares always costs more (binary market)", () => {
    const b = 20;
    let prev = costFunction([0, 0], b);
    for (const delta of [1, 5, 10, 20, 50, 100]) {
      const next = costFunction([delta, 0], b);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it("buying more shares costs more (5-outcome market)", () => {
    const b = 50;
    let prev = costFunction([0, 0, 0, 0, 0], b);
    for (const delta of [2, 10, 25, 50, 100]) {
      const q = [delta, 0, 0, 0, 0];
      const next = costFunction(q, b);
      expect(next).toBeGreaterThan(prev);
      prev = next;
    }
  });

  it("cost difference equals dollar amount spent (self-consistency)", () => {
    const q = [10, 5];
    const b = 30;
    const dollarAmount = 15;
    const delta = computeSharesForDollarAmount(q, b, 0, dollarAmount);
    const qNew = [q[0]! + delta, q[1]!];
    const costDiff = costFunction(qNew, b) - costFunction(q, b);
    expect(Math.abs(costDiff - dollarAmount)).toBeLessThan(COST_TOL);
  });

  it("adding shares to any outcome increases cost (all outcomes)", () => {
    const q = [5, 10, 3];
    const b = 25;
    const base = costFunction(q, b);
    for (let i = 0; i < q.length; i++) {
      const qNew = q.slice();
      qNew[i] = qNew[i]! + 20;
      expect(costFunction(qNew, b)).toBeGreaterThan(base);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. computeSharesForDollarAmount — closed-form correctness
// ---------------------------------------------------------------------------

describe("computeSharesForDollarAmount — closed-form correctness", () => {
  const cases = [
    { q: [0, 0], b: 20, idx: 0, dollars: 10 },
    { q: [0, 0], b: 20, idx: 1, dollars: 20 },
    { q: [50, 20], b: 40, idx: 0, dollars: 5 },
    { q: [0, 0, 0, 0, 0], b: 50, idx: 2, dollars: 15 },
    { q: [0, 0], b: 1, idx: 0, dollars: 0.5 }, // very small b
    { q: [0, 0], b: 10000, idx: 0, dollars: 25 }, // very large b
  ];

  for (const { q, b, idx, dollars } of cases) {
    it(`cost matches target: q=${JSON.stringify(q)}, b=${b}, idx=${idx}, $${dollars}`, () => {
      const delta = computeSharesForDollarAmount(q, b, idx, dollars);
      expect(delta).toBeGreaterThan(0);

      const qNew = q.slice();
      qNew[idx] = (q[idx] ?? 0) + delta;
      const costDiff = costFunction(qNew, b) - costFunction(q, b);
      expect(Math.abs(costDiff - dollars)).toBeLessThan(COST_TOL);
    });
  }

  it("result is rounded to 4 decimal places", () => {
    const delta = computeSharesForDollarAmount([0, 0], 20, 0, 15);
    const decimals = (delta.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("throws for dollarAmount <= 0", () => {
    expect(() => computeSharesForDollarAmount([0, 0], 20, 0, 0)).toThrow();
    expect(() => computeSharesForDollarAmount([0, 0], 20, 0, -5)).toThrow();
  });

  it("throws for out-of-range outcomeIndex", () => {
    expect(() => computeSharesForDollarAmount([0, 0], 20, 5, 10)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. computeSharesForDollarAmount — matches binary-search reference
// ---------------------------------------------------------------------------

describe("computeSharesForDollarAmount — closed-form matches binary-search reference", () => {
  const cases = [
    { q: [0, 0], b: 20, idx: 0, dollars: 10 },
    { q: [0, 0], b: 20, idx: 1, dollars: 20 },
    { q: [50, 20], b: 40, idx: 0, dollars: 5 },
    { q: [0, 0, 0, 0, 0], b: 50, idx: 2, dollars: 15 },
    { q: [0, 0], b: 1, idx: 0, dollars: 0.5 },
    { q: [0, 0], b: 10000, idx: 0, dollars: 25 },
    { q: [30, 10], b: 50, idx: 1, dollars: 8 },
    { q: [0, 0, 0], b: 30, idx: 0, dollars: 3 },
  ];

  for (const { q, b, idx, dollars } of cases) {
    it(`q=${JSON.stringify(q)}, b=${b}, idx=${idx}, $${dollars}`, () => {
      // Pass maxShares=Infinity so neither implementation is capped
      const closedForm = computeSharesForDollarAmount(
        q,
        b,
        idx,
        dollars,
        Infinity
      );
      const bsRef = binarySearchShares(q, b, idx, dollars);
      expect(Math.abs(closedForm - bsRef)).toBeLessThan(0.001);
    });
  }

  it("50 random cases match within 0.001", () => {
    const rand = lcg(77);
    let failures = 0;

    for (let i = 0; i < 50; i++) {
      const b = 5 + rand() * 195;
      const n = 2 + Math.floor(rand() * 3);
      const q = Array.from({ length: n }, () => rand() * 80); // keep q < 80 to stay well under cap
      const idx = Math.floor(rand() * n);
      const dollars = 0.5 + rand() * 9.5; // keep small so shares stay under cap

      try {
        const closedForm = computeSharesForDollarAmount(
          q,
          b,
          idx,
          dollars,
          Infinity
        );
        const bsRef = binarySearchShares(q, b, idx, dollars);
        if (Math.abs(closedForm - bsRef) >= 0.001) failures++;
      } catch {
        failures++;
      }
    }

    expect(failures).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. computeSharesForDollarAmount — SHARE_CAP_EXCEEDED guard
// ---------------------------------------------------------------------------

describe("computeSharesForDollarAmount — SHARE_CAP_EXCEEDED", () => {
  it("throws SHARE_CAP_EXCEEDED when shares would exceed maxShares=1000", () => {
    // Buying $5000 at b=20 from q=[0,0] yields far more than 1000 shares
    expect(() =>
      computeSharesForDollarAmount([0, 0], 20, 0, 5000)
    ).toThrowError(/SHARE_CAP_EXCEEDED/);
  });

  it("throws when outcome already at cap and any purchase attempted", () => {
    // qi is already at 1000; the smallest purchase exceeds maxShares
    expect(() =>
      computeSharesForDollarAmount([1000, 0], 272, 0, 0.01)
    ).toThrowError(/SHARE_CAP_EXCEEDED/);
  });

  it("succeeds when purchase lands exactly at maxShares boundary", () => {
    // Find a dollar amount that purchases exactly up to ~999 shares from q=0
    const b = 272;
    // At b=272, buying from q=[0,0], Δ = 272*ln(2*e^(X/272)-1)
    // We want Δ ≈ 999 so it's just under the cap
    const X = b * Math.log(Math.exp(999 / b) + 1) - b * Math.log(2); // ≈ cost of 999 shares
    const delta = computeSharesForDollarAmount([0, 0], b, 0, X); // default maxShares=1000
    expect(delta).toBeLessThanOrEqual(1000);
  });

  it("custom maxShares parameter is respected", () => {
    // maxShares=50: buying $10 at b=20 from q=[0,0] gives ~16 shares — fine
    expect(() =>
      computeSharesForDollarAmount([0, 0], 20, 0, 10, 50)
    ).not.toThrow();

    // But buying $30 at b=20 from q=[0,0] gives ~40+ shares — over custom cap of 30
    expect(() =>
      computeSharesForDollarAmount([0, 0], 20, 0, 30, 30)
    ).toThrowError(/SHARE_CAP_EXCEEDED/);
  });
});

// ---------------------------------------------------------------------------
// 7. computeDollarAmountForShares — selling
// ---------------------------------------------------------------------------

describe("computeDollarAmountForShares — selling", () => {
  it("selling shares returns a positive dollar amount", () => {
    const q = [40, 10];
    const b = 27;
    const revenue = computeDollarAmountForShares(q, b, 0, 10);
    expect(revenue).toBeGreaterThan(0);
  });

  it("selling more shares returns more money (monotonic)", () => {
    const q = [80, 10];
    const b = 27;
    const rev10 = computeDollarAmountForShares(q, b, 0, 10);
    const rev20 = computeDollarAmountForShares(q, b, 0, 20);
    const rev40 = computeDollarAmountForShares(q, b, 0, 40);
    expect(rev20).toBeGreaterThan(rev10);
    expect(rev40).toBeGreaterThan(rev20);
  });

  it("result equals the cost-function difference", () => {
    const q = [50, 20];
    const b = 30;
    const sharesToSell = 15;
    const revenue = computeDollarAmountForShares(q, b, 0, sharesToSell);
    const qAfter = [q[0]! - sharesToSell, q[1]!];
    const expectedRevenue = costFunction(q, b) - costFunction(qAfter, b);
    expect(Math.abs(revenue - expectedRevenue)).toBeLessThan(COST_TOL);
  });

  it("result is rounded to 4 decimal places", () => {
    const revenue = computeDollarAmountForShares([50, 20], 30, 0, 15);
    const decimals = (revenue.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("throws when sharesToSell > qᵢ", () => {
    expect(() =>
      computeDollarAmountForShares([20, 10], 27, 0, 25)
    ).toThrow(/cannot sell/);
  });

  it("throws when sharesToSell <= 0", () => {
    expect(() =>
      computeDollarAmountForShares([20, 10], 27, 0, 0)
    ).toThrow();
    expect(() =>
      computeDollarAmountForShares([20, 10], 27, 0, -5)
    ).toThrow();
  });

  it("throws for out-of-range outcomeIndex", () => {
    expect(() =>
      computeDollarAmountForShares([20, 10], 27, 5, 5)
    ).toThrow();
  });

  it("sells all shares on an outcome (full liquidation)", () => {
    const q = [30, 10];
    const b = 27;
    const revenue = computeDollarAmountForShares(q, b, 0, 30);
    expect(revenue).toBeGreaterThan(0);
    // After selling all, cost should equal C([0, 10], b)
    const cAfterSell = costFunction([0, q[1]!], b);
    const cBefore = costFunction(q, b);
    expect(Math.abs(revenue - (cBefore - cAfterSell))).toBeLessThan(COST_TOL);
  });

  it("5-outcome market: selling from non-zero index", () => {
    const q = [10, 5, 30, 8, 2];
    const b = 40;
    const revenue = computeDollarAmountForShares(q, b, 2, 10);
    expect(revenue).toBeGreaterThan(0);
    const qAfter = [10, 5, 20, 8, 2];
    const expected = costFunction(q, b) - costFunction(qAfter, b);
    expect(Math.abs(revenue - expected)).toBeLessThan(COST_TOL);
  });
});

// ---------------------------------------------------------------------------
// 8. Round-trip: buy X dollars → sell those shares → recover ≈ X dollars
// ---------------------------------------------------------------------------

describe("round-trip: buy then sell", () => {
  const cases = [
    { q: [0, 0], b: 27, idx: 0, dollars: 5 },
    { q: [20, 10], b: 27, idx: 0, dollars: 3 },
    { q: [0, 0, 0], b: 27, idx: 1, dollars: 8 },
    { q: [10, 5, 3], b: 40, idx: 2, dollars: 2 },
  ];

  for (const { q, b, idx, dollars } of cases) {
    it(`q=${JSON.stringify(q)}, b=${b}, idx=${idx}, $${dollars}`, () => {
      const shares = computeSharesForDollarAmount(q, b, idx, dollars);
      const qAfterBuy = q.slice();
      qAfterBuy[idx] = (q[idx] ?? 0) + shares;

      const sellRevenue = computeDollarAmountForShares(
        qAfterBuy,
        b,
        idx,
        shares
      );

      // Due to 4 d.p. rounding of the share count, won't be perfectly exact.
      // The round-trip error is at most the cost of the rounding difference.
      expect(Math.abs(sellRevenue - dollars)).toBeLessThan(0.01);
    });
  }

  it("sell revenue is always less than or equal to buy cost (no free money)", () => {
    const q = [0, 0];
    const b = 27;
    for (const dollars of [1, 5, 10, 20, 50]) {
      const shares = computeSharesForDollarAmount(q, b, 0, dollars);
      const qNew = [shares, 0];
      const revenue = computeDollarAmountForShares(qNew, b, 0, shares);
      // Revenue should be ≤ cost (LMSR is a proper scoring rule)
      expect(revenue).toBeLessThanOrEqual(dollars + 0.0001);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. defaultB — calibration targets
// ---------------------------------------------------------------------------

describe("defaultB — calibration targets", () => {
  it("binary market (n=2, M=1000) → b ≈ 271.7", () => {
    const b = defaultB(2, 1000);
    expect(b).toBeCloseTo(271.7, 0);
  });

  it("binary market (n=2, M=100) → b ≈ 27.2", () => {
    const b = defaultB(2, 100);
    expect(b).toBeCloseTo(27.17, 1);
  });

  it("binary market: p(0,0) = 0.50", () => {
    const b = defaultB(2);
    const p = allPrices([0, 0], b)[0]!;
    expect(p).toBeCloseTo(0.5, 4);
  });

  it("binary market: p at q=(500,0) ≈ 0.86", () => {
    const b = defaultB(2);
    const p = allPrices([500, 0], b)[0]!;
    expect(p).toBeCloseTo(0.86, 1);
  });

  it("binary market: p at q=(800,0) ≈ 0.95 (design target)", () => {
    const b = defaultB(2);
    const p = allPrices([800, 0], b)[0]!;
    expect(p).toBeCloseTo(0.95, 1);
  });

  it("binary market: p at q=(1000,0) ≈ 0.98", () => {
    const b = defaultB(2);
    const p = allPrices([1000, 0], b)[0]!;
    expect(p).toBeCloseTo(0.98, 1);
  });

  it("3-outcome market gives a smaller b (more price-sensitive)", () => {
    const b2 = defaultB(2);
    const b3 = defaultB(3);
    expect(b3).toBeLessThan(b2);
  });

  it("3-outcome market: p at q=(800,0,0) ≈ 0.95", () => {
    const b = defaultB(3);
    const p = allPrices([800, 0, 0], b)[0]!;
    expect(p).toBeCloseTo(0.95, 1);
  });

  it("default maxShares=1000 is used when omitted", () => {
    expect(defaultB(2)).toBeCloseTo(defaultB(2, 1000), 10);
  });

  it("scales proportionally with maxShares", () => {
    const b100 = defaultB(2, 100);
    const b200 = defaultB(2, 200);
    expect(b200).toBeCloseTo(b100 * 2, 6);
  });

  it("throws for numOutcomes < 2", () => {
    expect(() => defaultB(1)).toThrow();
    expect(() => defaultB(0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("very small b (b=1) — extreme price sensitivity", () => {
    const prices = allPrices([0, 0], 1);
    expect(prices[0]).toBeCloseTo(0.5, 4);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(EPSILON);
  });

  it("very large b (b=10000) — near-flat price impact", () => {
    const delta = computeSharesForDollarAmount([0, 0], 10000, 0, 50);
    const after = priceAfterPurchase([0, 0], 10000, 0, delta);
    // With huge b the price should barely move from 50¢
    expect(Math.abs(after[0]! - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(sum(after) - 1)).toBeLessThan(EPSILON);
  });

  it("5-outcome market — prices sum to 1", () => {
    const q = [20, 10, 5, 2, 1];
    const prices = allPrices(q, 40);
    expect(prices).toHaveLength(5);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(EPSILON);
  });

  it("near-certain outcome (one share >> others) — price approaches 1", () => {
    const q = [1000, 0];
    const b = 20;
    const prices = allPrices(q, b);
    expect(prices[0]).toBeGreaterThan(0.99);
    expect(prices[1]).toBeLessThan(0.01);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(EPSILON);
  });

  it("negative q values are allowed (market maker accounting)", () => {
    const q = [-10, 10];
    const prices = allPrices(q, 20);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(EPSILON);
    expect(prices[1]).toBeGreaterThan(prices[0]!);
  });

  it("maxHouseExposure is b × ln(n)", () => {
    expect(maxHouseExposure(20, 2)).toBeCloseTo(20 * Math.log(2), 6);
    expect(maxHouseExposure(20, 5)).toBeCloseTo(20 * Math.log(5), 6);
    expect(maxHouseExposure(200, 2)).toBeCloseTo(200 * Math.log(2), 6);
  });

  it("priceAfterPurchase updates only the purchased outcome's direction", () => {
    const q = [0, 0];
    const b = 20;
    const shares = 20;
    const newPrices = priceAfterPurchase(q, b, 0, shares);
    expect(newPrices[0]).toBeGreaterThan(0.5);
    expect(newPrices[1]).toBeLessThan(0.5);
    expect(Math.abs(sum(newPrices) - 1)).toBeLessThan(EPSILON);
  });

  it("costFunction increases after any purchase", () => {
    const before = costFunction([0, 0], 20);
    const after = costFunction([10, 0], 20);
    expect(after).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// 11. Price impact examples
// ---------------------------------------------------------------------------

describe("price impact example — binary market", () => {
  /**
   * $20 bet at b=20 from q=[0,0]:
   *   C_before = 20·ln(2) ≈ 13.863
   *   Δ = 20·ln(2e − 1) ≈ 29.806 shares
   *   p(Yes) = e^(Δ/b) / (e^(Δ/b)+1) ≈ 0.816
   */
  it("$20 bet on Yes at q=[0,0], b=20 → Yes price ≈ 0.816", () => {
    const q = [0, 0];
    const b = 20;
    const dollar = 20;

    const delta = computeSharesForDollarAmount(q, b, 0, dollar);
    expect(delta).toBeGreaterThan(25);

    const newPrices = priceAfterPurchase(q, b, 0, delta);
    expect(newPrices[0]).toBeCloseTo(0.816, 2);
    expect(newPrices[1]).toBeCloseTo(0.184, 2);
    expect(Math.abs(sum(newPrices) - 1)).toBeLessThan(EPSILON);
  });

  it("price moves monotonically toward purchased outcome", () => {
    const b = 27;
    let runningQ = [0, 0];
    let prevYesPrice = 0.5;

    for (const dollarsIn of [2, 3, 4, 5]) {
      const delta = computeSharesForDollarAmount(runningQ, b, 0, dollarsIn);
      runningQ = [runningQ[0]! + delta, runningQ[1]!];
      const yesPrice = allPrices(runningQ, b)[0]!;
      expect(yesPrice).toBeGreaterThan(prevYesPrice);
      prevYesPrice = yesPrice;
    }
  });

  it("purchase of No drives Yes price down", () => {
    const q = [0, 0];
    const b = 27;
    const delta = computeSharesForDollarAmount(q, b, 1, 10);
    const newPrices = priceAfterPurchase(q, b, 1, delta);
    expect(newPrices[0]).toBeLessThan(0.5);
    expect(newPrices[1]).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 12. Property test — 100 random (q, b) pairs
// ---------------------------------------------------------------------------

describe("property test — 100 random (q, b) pairs", () => {
  it("prices always sum to 1.0, all in (0,1)", () => {
    const rand = lcg(42);
    let failures = 0;

    for (let i = 0; i < 100; i++) {
      const b = 1 + rand() * 499;
      const n = 2 + Math.floor(rand() * 5);
      const q = Array.from({ length: n }, () => -100 + rand() * 300);

      const prices = allPrices(q, b);
      const s = sum(prices);

      if (Math.abs(s - 1) >= EPSILON) failures++;
      for (const p of prices) {
        if (p <= 0 || p >= 1) failures++;
      }
    }

    expect(failures).toBe(0);
  });

  it("cost function always finite and positive", () => {
    const rand = lcg(99);

    for (let i = 0; i < 100; i++) {
      const b = 1 + rand() * 999;
      const n = 2 + Math.floor(rand() * 4);
      const q = Array.from({ length: n }, () => -50 + rand() * 150);

      const c = costFunction(q, b);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
    }
  });

  it("computeSharesForDollarAmount always converges (50 random cases, uncapped)", () => {
    const rand = lcg(77);
    let failures = 0;

    for (let i = 0; i < 50; i++) {
      const b = 5 + rand() * 195;
      const n = 2 + Math.floor(rand() * 3);
      const q = Array.from({ length: n }, () => rand() * 100);
      const idx = Math.floor(rand() * n);
      const dollars = 0.5 + rand() * 19.5; // keep small; bypass cap with Infinity

      try {
        const delta = computeSharesForDollarAmount(q, b, idx, dollars, Infinity);
        const qNew = q.slice();
        qNew[idx] = (q[idx] ?? 0) + delta;
        const costDiff = costFunction(qNew, b) - costFunction(q, b);
        if (Math.abs(costDiff - dollars) >= COST_TOL) failures++;
      } catch {
        failures++;
      }
    }

    expect(failures).toBe(0);
  });
});
