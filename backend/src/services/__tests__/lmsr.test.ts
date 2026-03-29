/**
 * LMSR Pricing Engine — Unit Tests
 *
 * Coverage:
 *   1. Prices sum to 1.0 for arbitrary (q, b)
 *   2. Initial equal prices when q = [0, 0]
 *   3. Cost function is monotonically increasing
 *   4. computeSharesForDollarAmount binary search convergence
 *   5. Adaptive b formula — spot-check against PRD §4.3
 *   6. Edge cases (tiny b, huge b, 5-outcome market, near-certain outcome)
 *   7. Price impact example derived from PRD §4.4
 *   8. Property test — 100 random (q, b) pairs
 */

import { describe, expect, it } from "vitest";
import {
  adaptiveB,
  allPrices,
  computeSharesForDollarAmount,
  costFunction,
  maxHouseExposure,
  price,
  priceAfterPurchase,
} from "../lmsr.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EPSILON = 0.0001; // tolerance for prices-sum-to-1 tests
const COST_TOL = 0.01; // tolerance for binary-search cost convergence

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
    // C(q + Δe_i) - C(q) should equal the dollar amount we computed
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
// 4. computeSharesForDollarAmount — binary search convergence
// ---------------------------------------------------------------------------

describe("computeSharesForDollarAmount — convergence", () => {
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
      const delta = computeSharesForDollarAmount(q, b, idx, dollars);
      expect(delta).toBeGreaterThan(0);

      // Re-compute cost to verify convergence
      const qNew = q.slice();
      qNew[idx] = (q[idx] ?? 0) + delta;
      const costDiff = costFunction(qNew, b) - costFunction(q, b);
      expect(Math.abs(costDiff - dollars)).toBeLessThan(COST_TOL);
    });
  }

  it("$200 max bet on binary market always solvable", () => {
    const delta = computeSharesForDollarAmount([0, 0], 20, 0, 200);
    expect(delta).toBeGreaterThan(0);
    const qNew = [delta, 0];
    const costDiff = costFunction(qNew, 20) - costFunction([0, 0], 20);
    expect(Math.abs(costDiff - 200)).toBeLessThan(COST_TOL);
  });

  it("result is rounded to 4 decimal places", () => {
    const delta = computeSharesForDollarAmount([0, 0], 20, 0, 15);
    const decimals = (delta.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// 5. Adaptive b formula
// ---------------------------------------------------------------------------

describe("adaptiveB — PRD §4.3 formula verification", () => {
  /**
   * b(t,V) = max(bFloor, 20 + (0.6 × 0.25 × √Δt_ms) + (0.4 × 0.5 × V))
   *
   * bFloor defaults to 20 across all checks below.
   */
  const BF = 20;

  it("t=0, V=0 → b=20 (floor)", () => {
    expect(adaptiveB(BF, 0, 0)).toBeCloseTo(20, 1);
  });

  it("t=30s, V=$0 → b≈46 (time-only hardening)", () => {
    // 20 + 0.6×0.25×√30000 ≈ 20 + 25.98 = 45.98
    expect(adaptiveB(BF, 30_000, 0)).toBeCloseTo(45.98, 1);
  });

  it("t=30s, V=$100 → b≈66 (time + volume)", () => {
    // 45.98 + 0.4×0.5×100 = 45.98 + 20 = 65.98
    expect(adaptiveB(BF, 30_000, 100)).toBeCloseTo(65.98, 1);
  });

  it("t=5min, V=$500 → b≈202 (formula; PRD table shows 182 — see note)", () => {
    /**
     * NOTE: PRD §4.3 table lists b≈182 for this row, but applying the
     * documented formula exactly yields ≈202:
     *   20 + 0.6×0.25×√300000 + 0.4×0.5×500
     *   = 20 + 82.16 + 100 = 202.16
     *
     * The PRD table rows for t=2min and t=5min appear to have been
     * generated with different coefficients.  The formula in §4.3 and
     * CLAUDE.md is unambiguous; this implementation follows it exactly.
     */
    const b = adaptiveB(BF, 300_000, 500);
    expect(b).toBeCloseTo(202.16, 1);
  });

  it("b grows with time (volume constant)", () => {
    const v = 200;
    const b30s = adaptiveB(BF, 30_000, v);
    const b2m = adaptiveB(BF, 120_000, v);
    const b5m = adaptiveB(BF, 300_000, v);
    expect(b2m).toBeGreaterThan(b30s);
    expect(b5m).toBeGreaterThan(b2m);
  });

  it("b grows with volume (time constant)", () => {
    const t = 60_000;
    const b0 = adaptiveB(BF, t, 0);
    const b100 = adaptiveB(BF, t, 100);
    const b500 = adaptiveB(BF, t, 500);
    expect(b100).toBeGreaterThan(b0);
    expect(b500).toBeGreaterThan(b100);
  });

  it("b never falls below bFloor", () => {
    // Even with t=0, V=0, computed = 20 which equals bFloor.
    expect(adaptiveB(50, 0, 0)).toBe(50); // custom floor above 20
    expect(adaptiveB(20, 0, 0)).toBe(20); // standard floor
  });

  it("custom bFloor (admin-set) is respected", () => {
    // Admin sets bFloor=100; even at t=0,V=0, b should be 100.
    expect(adaptiveB(100, 0, 0)).toBe(100);
    // But once the formula exceeds it, formula wins.
    const highB = adaptiveB(100, 30_000_000, 0);
    expect(highB).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("very small b (b=1) — extreme price sensitivity", () => {
    const prices = allPrices([0, 0], 1);
    expect(prices[0]).toBeCloseTo(0.5, 4);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(EPSILON);
  });

  it("very large b (b=10000) — near-flat price impact", () => {
    const before = allPrices([0, 0], 10000);
    // Buy $50 of Yes
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
    // q[0] is far ahead; its price should be near 1
    const q = [1000, 0];
    const b = 20;
    const prices = allPrices(q, b);
    expect(prices[0]).toBeGreaterThan(0.99);
    expect(prices[1]).toBeLessThan(0.01);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(EPSILON);
  });

  it("negative q values are allowed (market maker accounting)", () => {
    // q can go negative if the house position is tracked that way
    const q = [-10, 10];
    const prices = allPrices(q, 20);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(EPSILON);
    // The outcome with higher q should have a higher price
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
    // Yes should be more expensive, No cheaper
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
// 7. Price impact example
// ---------------------------------------------------------------------------

describe("price impact example — binary market", () => {
  /**
   * Starting state: q=[0,0], b=20 (opening conditions, PRD §4.4).
   *
   * PRD §4.4 states: "$20 bet on Yes → price swings to Yes=$0.88, No=$0.12"
   *
   * NOTE: applying the LMSR formula exactly, a $20 bet at b=20 from q=[0,0]
   * yields Yes≈0.816, not 0.88.  The PRD example is illustrative and was
   * apparently generated with b≈14.  This test asserts the correct
   * mathematical output of the formula as documented in §4.2.
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

    const delta = computeSharesForDollarAmount(q, b, 0, dollar);
    expect(delta).toBeGreaterThan(25); // should receive many shares (cheap entry)

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
      const delta = computeSharesForDollarAmount(runningQ, b, 0, dollarsIn);
      runningQ = [runningQ[0]! + delta, runningQ[1]!];
      const yesPrice = allPrices(runningQ, b)[0]!;
      expect(yesPrice).toBeGreaterThan(prevYesPrice);
      prevYesPrice = yesPrice;
    }
  });

  it("purchase of No drives Yes price down", () => {
    const q = [0, 0];
    const b = 20;
    const delta = computeSharesForDollarAmount(q, b, 1, 20); // buy No
    const newPrices = priceAfterPurchase(q, b, 1, delta);
    expect(newPrices[0]).toBeLessThan(0.5); // Yes now cheaper
    expect(newPrices[1]).toBeGreaterThan(0.5); // No now more expensive
  });

  it("sequenced trades (PRD §4.4 narrative)", () => {
    /**
     * Approximate re-run of PRD §4.4 example with adaptive b.
     * Exact prices differ from the PRD (which has inaccurate values) but
     * the qualitative behaviour is verified: early mover has big impact,
     * later trades barely move the market.
     */
    let q = [0, 0];

    // Trade 1: Guest A bets $20 on Yes at t=0, V=$0 → b=20
    const b1 = adaptiveB(20, 0, 0); // 20
    const d1 = computeSharesForDollarAmount(q, b1, 0, 20);
    q = [q[0]! + d1, q[1]!];
    const p1Yes = allPrices(q, b1)[0]!;
    expect(p1Yes).toBeGreaterThan(0.75); // big first-mover impact

    // Trade 2: Guest B bets $10 on No at t=15s, V=$20 → b
    const b2 = adaptiveB(20, 15_000, 20);
    const d2 = computeSharesForDollarAmount(q, b2, 1, 10);
    q = [q[0]!, q[1]! + d2];
    const p2Yes = allPrices(q, b2)[0]!;
    expect(p2Yes).toBeLessThan(p1Yes); // No purchase moves Yes down

    // After many trades the market hardens (b grows → small price impact)
    const bHardened = adaptiveB(20, 300_000, 95);
    const smallDelta = computeSharesForDollarAmount(q, bHardened, 0, 10);
    const pBefore = allPrices(q, bHardened)[0]!;
    const qAfter = [q[0]! + smallDelta, q[1]!];
    const pAfter = allPrices(qAfter, bHardened)[0]!;
    // Hard market: $10 nudges the price only a small amount
    expect(pAfter - pBefore).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// 8. Property test — 100 random (q, b) pairs
// ---------------------------------------------------------------------------

describe("property test — 100 random (q, b) pairs", () => {
  it("prices always sum to 1.0, all in (0,1)", () => {
    const rand = lcg(42);
    let failures = 0;

    for (let i = 0; i < 100; i++) {
      // Random b in [1, 500]
      const b = 1 + rand() * 499;
      // Random number of outcomes [2, 6]
      const n = 2 + Math.floor(rand() * 5);
      // Random q values in [-100, 200]
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
      // Cost is always positive: b × ln(Σ e^xi) ≥ b × ln(1) = 0 when any q=0,
      // and in general C = b × max(q/b) + b × ln(Σ e^(qi/b - max)) ≥ max(q).
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
      const dollars = 0.5 + rand() * 199.5; // $0.50 – $200

      try {
        const delta = computeSharesForDollarAmount(q, b, idx, dollars);
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
