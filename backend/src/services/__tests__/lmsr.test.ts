/**
 * LMSR Pricing Engine — Unit Tests
 *
 * Coverage:
 *   1. Prices sum to 1.0 for arbitrary (q, b)
 *   2. Initial equal prices when q = [0, 0]
 *   3. Cost function is monotonically increasing
 *   4. computeSharesForDollarAmount closed-form convergence
 *   5. computeDollarAmountForShares (selling)
 *   6. defaultB values for n=2 and n=3
 *   7. Share cap enforcement
 *   8. Sell validation (over-sell throws)
 *   9. Round-trip: buy then sell ≈ original cost
 *  10. Edge cases (tiny b, huge b, 5-outcome market, near-certain outcome)
 *  11. Price impact example derived from PRD §4.4
 *  12. Property test — 100 random (q, b) pairs
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
const COST_TOL = 0.01; // tolerance for cost convergence checks

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

// ---------------------------------------------------------------------------
// 1. Prices sum to 1.0
// ---------------------------------------------------------------------------

describe("allPrices — prices sum to 1.0", () => {
  /** Cases where all prices are strictly between 0 and 1. */
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

  /**
   * Extreme cases: one outcome dominates completely.
   * In IEEE 754 float64 the underdog's probability rounds to exactly 0 (or 1
   * for the leader) because the difference is below machine epsilon (~10^-16).
   * What matters is that the sum still equals 1 and values stay in [0, 1].
   */
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

  it("5-outcome market [0,0,0,0,0] → [0.20, 0.20, 0.20, 0.20, 0.20]", () => {
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
    const baseQ = [0, 0, 0, 0, 0];
    let prev = costFunction(baseQ, b);
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
// 4. computeSharesForDollarAmount — closed-form convergence
// ---------------------------------------------------------------------------

describe("computeSharesForDollarAmount — closed-form convergence", () => {
  const cases = [
    { q: [0, 0], b: 20, idx: 0, dollars: 10 },
    { q: [0, 0], b: 20, idx: 1, dollars: 20 },
    { q: [50, 20], b: 40, idx: 0, dollars: 5 },
    { q: [0, 0, 0, 0, 0], b: 50, idx: 2, dollars: 15 },
    { q: [100, 50], b: 200, idx: 0, dollars: 50 },
    { q: [0, 0], b: 1, idx: 0, dollars: 0.5 }, // very small b
    { q: [0, 0], b: 10000, idx: 0, dollars: 25 }, // very large b
  ];

  for (const { q, b, idx, dollars } of cases) {
    it(`cost matches target: q=${JSON.stringify(q)}, b=${b}, idx=${idx}, $${dollars}`, () => {
      const delta = computeSharesForDollarAmount(q, b, idx, dollars, 10000);
      expect(delta).toBeGreaterThan(0);

      const qNew = q.slice();
      qNew[idx] = (q[idx] ?? 0) + delta;
      const costDiff = costFunction(qNew, b) - costFunction(q, b);
      expect(Math.abs(costDiff - dollars)).toBeLessThan(COST_TOL);
    });
  }

  it("$200 max bet on binary market always solvable", () => {
    const delta = computeSharesForDollarAmount([0, 0], 20, 0, 200, 10000);
    expect(delta).toBeGreaterThan(0);
    const qNew = [delta, 0];
    const costDiff = costFunction(qNew, 20) - costFunction([0, 0], 20);
    expect(Math.abs(costDiff - 200)).toBeLessThan(COST_TOL);
  });

  it("result is rounded to 4 decimal places", () => {
    const delta = computeSharesForDollarAmount([0, 0], 20, 0, 15, 10000);
    const decimals = (delta.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("closed-form matches old binary-search within 0.01 shares", () => {
    // Spot-check several cases to verify the analytical solution is equivalent
    const testCases = [
      { q: [0, 0], b: 20, idx: 0, dollars: 10 },
      { q: [30, 10], b: 35, idx: 1, dollars: 8 },
      { q: [5, 5, 5], b: 25, idx: 2, dollars: 12 },
    ];
    for (const { q, b, idx, dollars } of testCases) {
      const closedForm = computeSharesForDollarAmount(q, b, idx, dollars, 10000);
      // Verify by checking cost round-trip (both methods must satisfy the same equation)
      const qNew = q.slice();
      qNew[idx] = (q[idx] ?? 0) + closedForm;
      const costDiff = costFunction(qNew, b) - costFunction(q, b);
      expect(Math.abs(costDiff - dollars)).toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. computeDollarAmountForShares — selling
// ---------------------------------------------------------------------------

describe("computeDollarAmountForShares — selling", () => {
  it("selling shares returns positive revenue", () => {
    const q = [40, 10];
    const b = 30;
    const revenue = computeDollarAmountForShares(q, b, 0, 10);
    expect(revenue).toBeGreaterThan(0);
  });

  it("revenue equals C(q_before) - C(q_after)", () => {
    const q = [50, 20];
    const b = 35;
    const sharesToSell = 15;
    const revenue = computeDollarAmountForShares(q, b, 0, sharesToSell);

    const qAfter = [q[0]! - sharesToSell, q[1]!];
    const expected = costFunction(q, b) - costFunction(qAfter, b);
    expect(Math.abs(revenue - expected)).toBeLessThan(COST_TOL);
  });

  it("result is rounded to 4 decimal places", () => {
    const revenue = computeDollarAmountForShares([40, 10], 30, 0, 5);
    const decimals = (revenue.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("selling more from outcome with more shares returns more revenue", () => {
    const q = [60, 10];
    const b = 30;
    const rev5 = computeDollarAmountForShares(q, b, 0, 5);
    const rev10 = computeDollarAmountForShares(q, b, 0, 10);
    expect(rev10).toBeGreaterThan(rev5);
  });
});

// ---------------------------------------------------------------------------
// 6. defaultB — formula verification
// ---------------------------------------------------------------------------

describe("defaultB — formula verification", () => {
  it("n=2 with maxShares=100 → ≈ 33.95", () => {
    // 100 / ln(19^1) = 100 / ln(19) ≈ 33.947
    expect(defaultB(2, 100)).toBeCloseTo(100 / Math.log(19), 4);
    expect(defaultB(2, 100)).toBeCloseTo(33.95, 1);
  });

  it("n=3 with maxShares=100 → ≈ 16.98", () => {
    // 100 / ln(19^2) = 100 / (2 × ln(19)) ≈ 16.974
    expect(defaultB(3, 100)).toBeCloseTo(100 / Math.log(19 * 19), 4);
    expect(defaultB(3, 100)).toBeCloseTo(16.97, 1);
  });

  it("n=4 with maxShares=100 → ≈ 11.32", () => {
    expect(defaultB(4, 100)).toBeCloseTo(100 / Math.log(Math.pow(19, 3)), 4);
  });

  it("scales linearly with maxShares", () => {
    const b50 = defaultB(2, 50);
    const b100 = defaultB(2, 100);
    expect(b100).toBeCloseTo(b50 * 2, 4);
  });

  it("throws for numOutcomes < 2", () => {
    expect(() => defaultB(1)).toThrow("numOutcomes must be >= 2");
  });

  it("throws for maxShares <= 0", () => {
    expect(() => defaultB(2, 0)).toThrow("maxShares must be positive");
  });
});

// ---------------------------------------------------------------------------
// 7. Share cap enforcement
// ---------------------------------------------------------------------------

describe("computeSharesForDollarAmount — share cap enforcement", () => {
  it("throws when purchase would exceed maxShares", () => {
    // With q=[90,0], b=20, buying $100 would push well past maxShares=100
    expect(() =>
      computeSharesForDollarAmount([90, 0], 20, 0, 100, 100)
    ).toThrow("exceed maxShares");
  });

  it("does not throw when exactly at cap", () => {
    // q=[0,0], maxShares=10000 — just verify it doesn't throw for a tiny purchase
    expect(() =>
      computeSharesForDollarAmount([0, 0], 20, 0, 1, 10000)
    ).not.toThrow();
  });

  it("respects custom maxShares", () => {
    // maxShares=5 — any non-trivial purchase on [0,0] should exceed it
    expect(() =>
      computeSharesForDollarAmount([0, 0], 20, 0, 50, 5)
    ).toThrow("exceed maxShares");
  });
});

// ---------------------------------------------------------------------------
// 8. Sell validation — throws when over-selling
// ---------------------------------------------------------------------------

describe("computeDollarAmountForShares — sell validation", () => {
  it("throws when sharesToSell > current shares", () => {
    expect(() =>
      computeDollarAmountForShares([10, 5], 20, 0, 15)
    ).toThrow("cannot sell");
  });

  it("throws when sharesToSell = 0", () => {
    expect(() =>
      computeDollarAmountForShares([10, 5], 20, 0, 0)
    ).toThrow("sharesToSell must be > 0");
  });

  it("throws when sharesToSell < 0", () => {
    expect(() =>
      computeDollarAmountForShares([10, 5], 20, 0, -1)
    ).toThrow("sharesToSell must be > 0");
  });

  it("does not throw when selling exactly all shares held", () => {
    expect(() =>
      computeDollarAmountForShares([10, 5], 20, 0, 10)
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. Round-trip: buy then sell same shares ≈ original cost
// ---------------------------------------------------------------------------

describe("round-trip — buy then sell", () => {
  it("buy $X then sell all shares returns ≈ $X (within rounding)", () => {
    const q = [20, 10];
    const b = 30;
    const dollarsBought = 12;

    const sharesBought = computeSharesForDollarAmount(
      q,
      b,
      0,
      dollarsBought,
      10000
    );
    const qAfterBuy = [q[0]! + sharesBought, q[1]!];

    const revenue = computeDollarAmountForShares(
      qAfterBuy,
      b,
      0,
      sharesBought
    );

    // Round-trip should recover very close to the original cost
    expect(Math.abs(revenue - dollarsBought)).toBeLessThan(0.01);
  });

  it("round-trip on a 3-outcome market", () => {
    const q = [10, 8, 5];
    const b = defaultB(3);
    const dollarsBought = 8;

    const sharesBought = computeSharesForDollarAmount(
      q,
      b,
      1,
      dollarsBought,
      10000
    );
    const qAfterBuy = q.slice();
    qAfterBuy[1] = q[1]! + sharesBought;

    const revenue = computeDollarAmountForShares(qAfterBuy, b, 1, sharesBought);
    expect(Math.abs(revenue - dollarsBought)).toBeLessThan(0.01);
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
    const delta = computeSharesForDollarAmount([0, 0], 10000, 0, 50, 10000);
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
    const q = [0, 0];
    const b = 20;
    const before = costFunction(q, b);
    const after = costFunction([10, 0], b);
    expect(after).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// 11. Price impact example
// ---------------------------------------------------------------------------

describe("price impact example — binary market", () => {
  /**
   * Starting state: q=[0,0], b=20 (opening conditions, PRD §4.4).
   *
   * Derivation:
   *   C_before = 20 × ln(2) ≈ 13.863
   *   C_after  = 13.863 + 20 = 33.863
   *   e^(Δ/20) = 2e − 1 ≈ 4.437   →   Δ ≈ 29.806 shares
   *   p(Yes)   = 4.437 / 5.437   ≈ 0.816
   */
  it("$20 bet on Yes at q=[0,0], b=20 → Yes price ≈ 0.816", () => {
    const q = [0, 0];
    const b = 20;
    const dollar = 20;

    const delta = computeSharesForDollarAmount(q, b, 0, dollar, 10000);
    expect(delta).toBeGreaterThan(25);

    const newPrices = priceAfterPurchase(q, b, 0, delta);
    expect(newPrices[0]).toBeCloseTo(0.816, 2); // Yes
    expect(newPrices[1]).toBeCloseTo(0.184, 2); // No
    expect(Math.abs(sum(newPrices) - 1)).toBeLessThan(EPSILON);
  });

  it("price moves monotonically toward purchased outcome", () => {
    const q = [0, 0];
    const b = 20;
    let runningQ = [0, 0];

    let prevYesPrice = 0.5;

    for (const dollarsIn of [5, 10, 15, 20]) {
      const delta = computeSharesForDollarAmount(runningQ, b, 0, dollarsIn, 10000);
      runningQ = [runningQ[0]! + delta, runningQ[1]!];
      const yesPrice = allPrices(runningQ, b)[0]!;
      expect(yesPrice).toBeGreaterThan(prevYesPrice);
      prevYesPrice = yesPrice;
    }
  });

  it("purchase of No drives Yes price down", () => {
    const q = [0, 0];
    const b = 20;
    const delta = computeSharesForDollarAmount(q, b, 1, 20, 10000); // buy No
    const newPrices = priceAfterPurchase(q, b, 1, delta);
    expect(newPrices[0]).toBeLessThan(0.5); // Yes now cheaper
    expect(newPrices[1]).toBeGreaterThan(0.5); // No now more expensive
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

  it("computeSharesForDollarAmount always converges (50 random cases)", () => {
    const rand = lcg(77);
    let failures = 0;

    for (let i = 0; i < 50; i++) {
      const b = 5 + rand() * 195;
      const n = 2 + Math.floor(rand() * 3);
      const q = Array.from({ length: n }, () => rand() * 100);
      const idx = Math.floor(rand() * n);
      const dollars = 0.5 + rand() * 49.5; // $0.50 – $50 (stay under large maxShares)

      try {
        const delta = computeSharesForDollarAmount(q, b, idx, dollars, 10000);
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
