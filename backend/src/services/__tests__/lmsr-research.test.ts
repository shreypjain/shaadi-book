/**
 * LMSR Research & Validation Tests
 *
 * Extended test suite produced by quantitative analysis of the LMSR pricing
 * engine. Covers five research scenarios:
 *
 *   a) Time-series simulation   — 20 sequential bets, alternating Yes/No
 *   b) Extreme b values          — b=1 (hyper-volatile) and b=10000 (frozen)
 *   c) 5-outcome market          — prices always sum to 1
 *   d) House exposure tracking   — max_loss = b×ln(n) verified at each step
 *   e) Price convergence         — 70% Yes money → Yes price leads
 *
 * Additional coverage:
 *   f) Adaptive b growth-rate analysis & PRD §4.3 table cross-check
 *   g) Closed-form binary price-impact formula validation
 *   h) PRD §4.4 narrative b-value cross-check (discrepancies logged)
 *   i) Numerical stability at extreme share counts
 *
 * All findings are summarised in LMSR-RESEARCH.md at the repo root.
 */

import { describe, expect, it } from "vitest";
import {
  adaptiveB,
  allPrices,
  computeSharesForDollarAmount,
  costFunction,
  maxHouseExposure,
  priceAfterPurchase,
} from "../lmsr.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const PRICE_SUM_TOL = 1e-4; // tolerance for Σp = 1 checks
const COST_TOL = 1e-2; // tolerance for binary-search cost reconstruction
const MS_PER_SEC = 1_000;
const MS_PER_MIN = 60 * MS_PER_SEC;
const MS_PER_HR = 60 * MS_PER_MIN;

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/** LCG seeded PRNG for reproducible randomness. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Closed-form price after a single $D bet on a 50/50 binary market (q=[0,0]).
 *
 * Derivation:
 *   C_before = b·ln(2)
 *   C_after  = b·ln(2) + D
 *   b·ln(e^(Δ/b)+1) = b·ln(2) + D
 *   e^(Δ/b) = 2·e^(D/b) − 1
 *   p(Yes)   = (2·e^(D/b) − 1) / (2·e^(D/b))
 *            = 1 − e^(−D/b)/2
 */
function closedFormBinaryPrice(dollarBet: number, b: number): number {
  return 1 - Math.exp(-dollarBet / b) / 2;
}

// ---------------------------------------------------------------------------
// a) Time-series simulation — 20 sequential bets
// ---------------------------------------------------------------------------

describe("(a) Time-series simulation — 20 sequential bets", () => {
  /**
   * Simulates a realistic market sequence: bets alternate between Yes and No
   * with amounts varying from $5 to $50. b evolves adaptively every 30 s.
   *
   * We verify:
   *   1. Prices always sum to 1 after every trade.
   *   2. b is strictly non-decreasing (time increases monotonically).
   *   3. Price oscillates between the two outcomes as bets alternate.
   *   4. Price swings shrink over time as b grows (market hardens).
   */
  const BET_SEQUENCE = [
    { outcome: 0, amount: 30 }, // Yes $30
    { outcome: 1, amount: 15 }, // No  $15
    { outcome: 0, amount: 50 }, // Yes $50
    { outcome: 1, amount: 10 }, // No  $10
    { outcome: 0, amount: 20 }, // Yes $20
    { outcome: 1, amount: 45 }, // No  $45
    { outcome: 0, amount: 5  }, // Yes $5
    { outcome: 1, amount: 35 }, // No  $35
    { outcome: 0, amount: 25 }, // Yes $25
    { outcome: 1, amount: 40 }, // No  $40
    { outcome: 0, amount: 50 }, // Yes $50
    { outcome: 1, amount: 20 }, // No  $20
    { outcome: 0, amount: 15 }, // Yes $15
    { outcome: 1, amount: 50 }, // No  $50
    { outcome: 0, amount: 8  }, // Yes $8
    { outcome: 1, amount: 30 }, // No  $30
    { outcome: 0, amount: 50 }, // Yes $50
    { outcome: 1, amount: 12 }, // No  $12
    { outcome: 0, amount: 35 }, // Yes $35
    { outcome: 1, amount: 25 }, // No  $25
  ];

  it("prices always sum to 1 after every trade", () => {
    let q = [0, 0];
    let totalVolume = 0;
    let elapsedMs = 0;

    for (const { outcome, amount } of BET_SEQUENCE) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const delta = computeSharesForDollarAmount(q, b, outcome, amount);
      const qNew = q.slice();
      qNew[outcome] = (qNew[outcome] ?? 0) + delta;
      q = qNew;

      const prices = allPrices(q, b);
      expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }

      totalVolume += amount;
      elapsedMs += 30 * MS_PER_SEC;
    }
  });

  it("b is strictly non-decreasing (time flows forward)", () => {
    let totalVolume = 0;
    let elapsedMs = 0;
    let prevB = adaptiveB(20, 0, 0);

    for (const { amount } of BET_SEQUENCE) {
      elapsedMs += 30 * MS_PER_SEC;
      totalVolume += amount;
      const b = adaptiveB(20, elapsedMs, totalVolume);
      expect(b).toBeGreaterThanOrEqual(prevB);
      prevB = b;
    }
  });

  it("early bets swing price more than late bets (market hardening)", () => {
    let q = [0, 0];
    let totalVolume = 0;
    let elapsedMs = 0;
    const swings: number[] = [];

    for (const { outcome, amount } of BET_SEQUENCE) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const pBefore = allPrices(q, b)[outcome]!;
      const delta = computeSharesForDollarAmount(q, b, outcome, amount);
      const qNew = q.slice();
      qNew[outcome] = (qNew[outcome] ?? 0) + delta;
      q = qNew;
      const pAfter = allPrices(q, b)[outcome]!;
      swings.push(Math.abs(pAfter - pBefore));

      totalVolume += amount;
      elapsedMs += 30 * MS_PER_SEC;
    }

    // Average swing in first 5 bets should exceed average in last 5 bets.
    const earlyAvg = swings.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const lateAvg = swings.slice(-5).reduce((a, b) => a + b, 0) / 5;
    expect(earlyAvg).toBeGreaterThan(lateAvg);
  });

  it("each purchase moves price in the correct direction", () => {
    let q = [0, 0];
    let totalVolume = 0;
    let elapsedMs = 0;

    for (const { outcome, amount } of BET_SEQUENCE) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const pBefore = allPrices(q, b)[outcome]!;
      const delta = computeSharesForDollarAmount(q, b, outcome, amount);
      const qNew = q.slice();
      qNew[outcome] = (qNew[outcome] ?? 0) + delta;
      q = qNew;
      const pAfter = allPrices(q, b)[outcome]!;

      // Bought outcome should increase in price.
      expect(pAfter).toBeGreaterThan(pBefore);

      totalVolume += amount;
      elapsedMs += 30 * MS_PER_SEC;
    }
  });

  it("cost reconstructs spent dollars at each step", () => {
    let q = [0, 0];
    let totalVolume = 0;
    let elapsedMs = 0;

    for (const { outcome, amount } of BET_SEQUENCE) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const cBefore = costFunction(q, b);
      const delta = computeSharesForDollarAmount(q, b, outcome, amount);
      const qNew = q.slice();
      qNew[outcome] = (qNew[outcome] ?? 0) + delta;
      q = qNew;
      const cAfter = costFunction(q, b);

      // Cost difference must equal the dollar amount spent (within tolerance).
      expect(Math.abs(cAfter - cBefore - amount)).toBeLessThan(COST_TOL);

      totalVolume += amount;
      elapsedMs += 30 * MS_PER_SEC;
    }
  });
});

// ---------------------------------------------------------------------------
// b) Extreme b values — b=1 and b=10000
// ---------------------------------------------------------------------------

describe("(b) Extreme b values", () => {
  describe("b=1 — hyper-volatile", () => {
    const B = 1;

    it("prices still sum to 1", () => {
      const prices = allPrices([0, 0], B);
      expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
    });

    it("$5 bet at b=1 drives Yes price above 0.99 from 50/50", () => {
      // Closed-form: p = 1 − e^(−D/b)/2 = 1 − e^(−5)/2 ≈ 0.997
      // $1 at b=1 gives only 81.6¢ (D/b = 1, not extreme enough).
      // $5 at b=1 gives 99.7¢ — genuinely hyper-volatile.
      const delta = computeSharesForDollarAmount([0, 0], B, 0, 5);
      const prices = priceAfterPurchase([0, 0], B, 0, delta);
      expect(prices[0]).toBeGreaterThan(0.99);
      expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
    });

    it("$0.10 bet converges correctly", () => {
      const q = [0, 0];
      const delta = computeSharesForDollarAmount(q, B, 0, 0.1);
      expect(delta).toBeGreaterThan(0);
      const qNew = [delta, 0];
      const costDiff = costFunction(qNew, B) - costFunction(q, B);
      expect(Math.abs(costDiff - 0.1)).toBeLessThan(COST_TOL);
    });

    it("$50 bet at b=1 — no overflow, prices valid", () => {
      // At b=1, e^(Δ/1) can be astronomically large. Log-sum-exp must handle it.
      const q = [0, 0];
      const delta = computeSharesForDollarAmount(q, B, 0, 50);
      expect(delta).toBeGreaterThan(0);
      expect(Number.isFinite(delta)).toBe(true);
      const qNew = [delta, 0];
      const prices = allPrices(qNew, B);
      expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
      for (const p of prices) {
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });

    it("5-outcome market at b=1 — prices sum to 1", () => {
      const q = [10, 5, 2, 8, 0];
      const prices = allPrices(q, B);
      expect(prices).toHaveLength(5);
      expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
    });
  });

  describe("b=10000 — frozen market", () => {
    const B = 10000;

    it("prices sum to 1", () => {
      const prices = allPrices([0, 0], B);
      expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
    });

    it("$50 bet barely moves price (< 0.5¢ move)", () => {
      const q = [0, 0];
      const delta = computeSharesForDollarAmount(q, B, 0, 50);
      const before = allPrices(q, B)[0]!;
      const after = priceAfterPurchase(q, B, 0, delta)[0]!;
      expect(after - before).toBeLessThan(0.005);
      expect(Math.abs(sum(priceAfterPurchase(q, B, 0, delta)) - 1)).toBeLessThan(PRICE_SUM_TOL);
    });

    it("$50 bet converges correctly at b=10000", () => {
      const q = [0, 0];
      const delta = computeSharesForDollarAmount(q, B, 0, 50);
      expect(delta).toBeGreaterThan(0);
      const qNew = [delta, 0];
      const costDiff = costFunction(qNew, B) - costFunction(q, B);
      expect(Math.abs(costDiff - 50)).toBeLessThan(COST_TOL);
    });

    it("cost function is finite for enormous b", () => {
      const c = costFunction([100, 200, 50], B);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
    });

    it("price impact scales as ~D/(2b) for small bets relative to b", () => {
      // Closed-form: p = 1 − e^(−D/b)/2
      // Taylor at D/b → 0: p ≈ 0.5 + D/(2b)
      // So Δp = p − 0.5 ≈ D/(2b) = 50/(2×10000) = 0.0025
      const q = [0, 0];
      const D = 50;
      const delta = computeSharesForDollarAmount(q, B, 0, D);
      const pAfter = priceAfterPurchase(q, B, 0, delta)[0]!;
      const approxImpact = D / (2 * B); // 0.0025
      const actualImpact = pAfter - 0.5;
      // Should agree to within 2% of the approximation.
      expect(Math.abs(actualImpact - approxImpact) / approxImpact).toBeLessThan(0.02);
    });
  });
});

// ---------------------------------------------------------------------------
// c) 5-outcome market
// ---------------------------------------------------------------------------

describe("(c) 5-outcome market — prices always sum to 1", () => {
  const FIVE_OUTCOME_BETS = [
    { idx: 0, dollars: 20 },
    { idx: 1, dollars: 15 },
    { idx: 2, dollars: 30 },
    { idx: 3, dollars: 10 },
    { idx: 4, dollars: 25 },
    { idx: 0, dollars: 50 },
    { idx: 2, dollars: 35 },
    { idx: 4, dollars: 20 },
    { idx: 1, dollars: 50 },
    { idx: 3, dollars: 45 },
    { idx: 0, dollars: 12 },
    { idx: 4, dollars: 8  },
  ];

  it("prices sum to 1 after each of the 12 bets", () => {
    let q = [0, 0, 0, 0, 0];
    let totalVolume = 0;
    let elapsedMs = 0;

    for (const { idx, dollars } of FIVE_OUTCOME_BETS) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const delta = computeSharesForDollarAmount(q, b, idx, dollars);
      const qNew = q.slice();
      qNew[idx] = (qNew[idx] ?? 0) + delta;
      q = qNew;

      const prices = allPrices(q, b);
      expect(prices).toHaveLength(5);
      expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
      for (const p of prices) {
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }

      totalVolume += dollars;
      elapsedMs += 20 * MS_PER_SEC;
    }
  });

  it("highest-share-count outcome has highest price at every step (fixed b)", () => {
    // Use a fixed b so the share-to-price mapping is stable across bets.
    // This lets us assert that the outcome with the most shares always leads.
    const FIXED_B = 50;
    let q = [0, 0, 0, 0, 0];

    for (const { idx, dollars } of FIVE_OUTCOME_BETS) {
      const delta = computeSharesForDollarAmount(q, FIXED_B, idx, dollars);
      q[idx] = (q[idx] ?? 0) + delta;

      const prices = allPrices(q, FIXED_B);
      // The outcome with the most shares must have the highest price.
      const maxShares = Math.max(...q);
      const maxSharesIdx = q.indexOf(maxShares);
      const maxPrice = Math.max(...prices);
      expect(prices[maxSharesIdx]).toBeCloseTo(maxPrice, 5);
    }
  });

  it("cost reconstruction accurate for 5-outcome market", () => {
    let q = [0, 0, 0, 0, 0];
    const b = 50;

    for (const { idx, dollars } of FIVE_OUTCOME_BETS.slice(0, 5)) {
      const cBefore = costFunction(q, b);
      const delta = computeSharesForDollarAmount(q, b, idx, dollars);
      q[idx] = (q[idx] ?? 0) + delta;
      const cAfter = costFunction(q, b);
      expect(Math.abs(cAfter - cBefore - dollars)).toBeLessThan(COST_TOL);
    }
  });

  it("max house exposure = b×ln(5) at every step", () => {
    let totalVolume = 0;
    let elapsedMs = 0;
    const n = 5;

    for (const { dollars } of FIVE_OUTCOME_BETS) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const exposure = maxHouseExposure(b, n);
      expect(exposure).toBeCloseTo(b * Math.log(n), 5);
      totalVolume += dollars;
      elapsedMs += 20 * MS_PER_SEC;
    }
  });
});

// ---------------------------------------------------------------------------
// d) House exposure tracking
// ---------------------------------------------------------------------------

describe("(d) House exposure tracking", () => {
  it("binary market: exposure = b×ln(2) and grows with b", () => {
    let totalVolume = 0;
    let elapsedMs = 0;
    let prevExposure = 0;

    for (let i = 0; i < 10; i++) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const exposure = maxHouseExposure(b, 2);

      expect(exposure).toBeCloseTo(b * Math.log(2), 6);
      expect(exposure).toBeGreaterThanOrEqual(prevExposure);

      prevExposure = exposure;
      totalVolume += 30;
      elapsedMs += 30 * MS_PER_SEC;
    }
  });

  it("5-outcome market: exposure = b×ln(5) throughout", () => {
    let totalVolume = 0;
    let elapsedMs = 0;

    for (let i = 0; i < 8; i++) {
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const exposure = maxHouseExposure(b, 5);
      expect(exposure).toBeCloseTo(b * Math.log(5), 6);
      totalVolume += 50;
      elapsedMs += 45 * MS_PER_SEC;
    }
  });

  it("exposure at realistic wedding-scale b values", () => {
    // After 1 hour with $1000 volume:
    // b = 20 + 0.15×sqrt(3_600_000) + 0.2×1000 = 20 + 284.6 + 200 = 504.6
    const b = adaptiveB(20, 1 * MS_PER_HR, 1000);
    expect(b).toBeGreaterThan(400);
    expect(b).toBeLessThan(700);

    const exposureBinary = maxHouseExposure(b, 2);
    const exposureFive = maxHouseExposure(b, 5);

    // Binary exposure: ~b×0.693 ≈ $350 at b≈500
    expect(exposureBinary).toBeGreaterThan(200);
    expect(exposureBinary).toBeLessThan(600);

    // 5-outcome exposure: ~b×1.609 ≈ $810 at b≈500
    expect(exposureFive).toBeGreaterThan(exposureBinary);
    expect(exposureFive / exposureBinary).toBeCloseTo(Math.log(5) / Math.log(2), 1);
  });

  it("exposure at t=24hrs, V=$10000 (extreme scale)", () => {
    // b = 20 + 0.15×sqrt(86_400_000) + 0.2×10000 = 20 + 1394.3 + 2000 = 3414.3
    const b = adaptiveB(20, 24 * MS_PER_HR, 10_000);
    expect(b).toBeGreaterThan(3000);

    const exposure = maxHouseExposure(b, 2);
    expect(exposure).toBeGreaterThan(2000); // ~$2366 at b≈3414
    expect(Number.isFinite(exposure)).toBe(true);
  });

  it("exposure ratio binary vs 5-outcome is always ln(5)/ln(2)", () => {
    const testPoints = [
      { dtMs: 0, V: 0 },
      { dtMs: 5 * MS_PER_MIN, V: 500 },
      { dtMs: 1 * MS_PER_HR, V: 2000 },
      { dtMs: 24 * MS_PER_HR, V: 10_000 },
    ];

    for (const { dtMs, V } of testPoints) {
      const b = adaptiveB(20, dtMs, V);
      const e2 = maxHouseExposure(b, 2);
      const e5 = maxHouseExposure(b, 5);
      expect(e5 / e2).toBeCloseTo(Math.log(5) / Math.log(2), 5);
    }
  });
});

// ---------------------------------------------------------------------------
// e) Price convergence — 70% Yes money → Yes price leads
// ---------------------------------------------------------------------------

describe("(e) Price convergence — directional bias reflected in price", () => {
  /**
   * LMSR price convergence note:
   *
   * In LMSR, price = softmax(q/b), where q is share count, not dollars spent.
   * Because expensive outcomes give fewer shares per dollar, the price does NOT
   * converge to the exact fraction of dollars — it reflects the share-weighted
   * signal. However, if one outcome consistently receives more dollars, its
   * share count grows faster and its price leads.
   */

  it("70% Yes money → Yes price leads No after 100 bets", () => {
    const rand = lcg(31415);
    let q = [0, 0];
    let elapsedMs = 0;
    let totalVolume = 0;

    for (let i = 0; i < 100; i++) {
      const isYes = rand() < 0.7;
      const amount = 5 + rand() * 45; // $5–$50
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const delta = computeSharesForDollarAmount(q, b, isYes ? 0 : 1, amount);
      q[isYes ? 0 : 1] = (q[isYes ? 0 : 1] ?? 0) + delta;
      totalVolume += amount;
      elapsedMs += 10 * MS_PER_SEC;
    }

    const finalB = adaptiveB(20, elapsedMs, totalVolume);
    const prices = allPrices(q, finalB);

    // Yes dominates: price should be > 0.5.
    expect(prices[0]).toBeGreaterThan(0.5);
    expect(prices[0]).toBeGreaterThan(prices[1]!);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
  });

  it("90% Yes money → Yes price strongly leads (>0.7)", () => {
    const rand = lcg(27182);
    let q = [0, 0];
    let elapsedMs = 0;
    let totalVolume = 0;

    for (let i = 0; i < 100; i++) {
      const isYes = rand() < 0.9;
      const amount = 10 + rand() * 40; // $10–$50
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const delta = computeSharesForDollarAmount(q, b, isYes ? 0 : 1, amount);
      q[isYes ? 0 : 1] = (q[isYes ? 0 : 1] ?? 0) + delta;
      totalVolume += amount;
      elapsedMs += 10 * MS_PER_SEC;
    }

    const finalB = adaptiveB(20, elapsedMs, totalVolume);
    const prices = allPrices(q, finalB);

    expect(prices[0]).toBeGreaterThan(0.7);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
  });

  it("50/50 money split → prices remain near 0.5 after 100 bets", () => {
    const rand = lcg(16180);
    let q = [0, 0];
    let elapsedMs = 0;
    let totalVolume = 0;

    // Strictly alternate Yes/No with equal amounts for perfectly balanced signal.
    for (let i = 0; i < 100; i++) {
      const outcome = i % 2;
      const amount = 20; // fixed $20 for perfect balance
      const b = adaptiveB(20, elapsedMs, totalVolume);
      const delta = computeSharesForDollarAmount(q, b, outcome, amount);
      q[outcome] = (q[outcome] ?? 0) + delta;
      totalVolume += amount;
      elapsedMs += 10 * MS_PER_SEC;
    }

    const finalB = adaptiveB(20, elapsedMs, totalVolume);
    const prices = allPrices(q, finalB);

    // Balanced betting → price should remain near 0.5 for both outcomes.
    expect(Math.abs(prices[0]! - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
  });
});

// ---------------------------------------------------------------------------
// f) Adaptive b growth rate & PRD §4.3 table cross-check
// ---------------------------------------------------------------------------

describe("(f) Adaptive b — growth rate & PRD §4.3 table cross-check", () => {
  /**
   * PRD §4.3 formula (as implemented):
   *   b(t,V) = max(bFloor, 20 + 0.6×0.25×√(dt_ms) + 0.4×0.5×V)
   *          = max(bFloor, 20 + 0.15×√(dt_ms) + 0.2×V)
   *
   * PRD §4.3 TABLE vs formula:
   *   Row 1: t=0,    V=$0    → formula=20    | PRD says 20  ✓
   *   Row 2: t=30s,  V=$0    → formula=45.98 | PRD says 46  ✓
   *   Row 3: t=30s,  V=$100  → formula=65.98 | PRD says 66  ✓
   *   Row 4: t=2min, V=$200  → formula=111.96| PRD says 106 ✗ (off by ~5.6%)
   *   Row 5: t=5min, V=$500  → formula=202.16| PRD says 182 ✗ (off by ~11%)
   *   Row 6: t=15min,V=$1000 → formula=362.3 | PRD says 447 ✗ (off by ~23%)
   *   Row 7: t=30min,V=$2000 → formula=621.2 | PRD says 661 ✗ (off by ~6%)
   *
   * The implemented formula is correct; the PRD table rows 4-7 appear to have
   * been generated with different internal coefficients. The formula text in
   * both CLAUDE.md and PRD §4.3 is unambiguous and the implementation follows it.
   *
   * These tests assert the FORMULA-CORRECT values, not the PRD table values.
   */

  it("t=0, V=0 → b=20 (base)", () => {
    expect(adaptiveB(20, 0, 0)).toBeCloseTo(20.0, 1);
  });

  it("t=30s, V=0 → b≈45.98 (formula; PRD table ≈46 ✓)", () => {
    // 20 + 0.15×√30000 = 20 + 0.15×173.2 = 45.98
    expect(adaptiveB(20, 30 * MS_PER_SEC, 0)).toBeCloseTo(45.98, 1);
  });

  it("t=30s, V=$100 → b≈65.98 (formula; PRD table ≈66 ✓)", () => {
    // 45.98 + 0.2×100 = 65.98
    expect(adaptiveB(20, 30 * MS_PER_SEC, 100)).toBeCloseTo(65.98, 1);
  });

  it("t=2min, V=$200 → formula gives 111.96 (PRD table says 106 — diverges)", () => {
    // 20 + 0.15×√120000 + 0.2×200 = 20 + 51.96 + 40 = 111.96
    const b = adaptiveB(20, 2 * MS_PER_MIN, 200);
    expect(b).toBeCloseTo(111.96, 1);
    // Explicitly document the PRD table discrepancy.
    expect(Math.abs(b - 106)).toBeGreaterThan(3); // ≠ PRD's 106
  });

  it("t=5min, V=$500 → formula gives 202.16 (PRD table says 182 — diverges)", () => {
    // 20 + 0.15×√300000 + 0.2×500 = 20 + 82.16 + 100 = 202.16
    const b = adaptiveB(20, 5 * MS_PER_MIN, 500);
    expect(b).toBeCloseTo(202.16, 1);
    expect(Math.abs(b - 182)).toBeGreaterThan(10); // ≠ PRD's 182
  });

  it("t=15min, V=$1000 → formula gives 362.3 (PRD table says 447 — diverges)", () => {
    // 20 + 0.15×√900000 + 0.2×1000 = 20 + 142.3 + 200 = 362.3
    const b = adaptiveB(20, 15 * MS_PER_MIN, 1000);
    expect(b).toBeCloseTo(362.3, 0);
    expect(Math.abs(b - 447)).toBeGreaterThan(50); // ≠ PRD's 447
  });

  it("t=30min, V=$2000 → formula gives 621.2 (PRD table says 661 — diverges)", () => {
    // 20 + 0.15×√1800000 + 0.2×2000 = 20 + 201.2 + 400 = 621.2
    const b = adaptiveB(20, 30 * MS_PER_MIN, 2000);
    expect(b).toBeCloseTo(621.2, 0);
    expect(Math.abs(b - 661)).toBeGreaterThan(20); // ≠ PRD's 661
  });

  it("t=24hrs, V=$10000 — extreme scale, no overflow", () => {
    // 20 + 0.15×√86_400_000 + 0.2×10000 = 20 + 1394.3 + 2000 = 3414.3
    const b = adaptiveB(20, 24 * MS_PER_HR, 10_000);
    expect(b).toBeCloseTo(3414.3, 0);
    expect(Number.isFinite(b)).toBe(true);
  });

  it("b grows as sqrt(t) holding V constant", () => {
    const V = 100;
    const ts = [1, 4, 9, 16, 25].map((k) => k * MS_PER_MIN);
    const bs = ts.map((t) => adaptiveB(20, t, V));
    // Differences should grow sub-linearly (sqrt relationship).
    for (let i = 1; i < bs.length; i++) {
      expect(bs[i]).toBeGreaterThan(bs[i - 1]!);
    }
    // From t=1min to t=4min: sqrt ratio = 2, so time component doubles.
    const timeComponent1 = 0.15 * Math.sqrt(1 * MS_PER_MIN);
    const timeComponent4 = 0.15 * Math.sqrt(4 * MS_PER_MIN);
    expect(timeComponent4 / timeComponent1).toBeCloseTo(2, 3);
  });

  it("b grows linearly with V holding t constant", () => {
    const t = 5 * MS_PER_MIN;
    const volumes = [0, 100, 200, 300, 400, 500];
    const bs = volumes.map((V) => adaptiveB(20, t, V));
    const diffs = bs.slice(1).map((b, i) => b - bs[i]!);
    // Each $100 increment adds 0.2×100 = 20 to b.
    for (const d of diffs) {
      expect(d).toBeCloseTo(20, 4);
    }
  });

  it("60/40 weighting: time component dominates at low volume", () => {
    // At t=5min, V=$0 vs V=$100:
    const bTime = adaptiveB(20, 5 * MS_PER_MIN, 0);
    const bBoth = adaptiveB(20, 5 * MS_PER_MIN, 100);
    const volumeContribution = bBoth - bTime; // = 0.2×100 = 20
    const timeContribution = bTime - 20;       // = 0.15×√300000 ≈ 82.16
    expect(timeContribution).toBeGreaterThan(volumeContribution);
  });

  it("PRD note: 30min zero-volume market b≈82 (stabilized, not frozen)", () => {
    // PRD §4.3 says: "b ≈ 82" for 30min open with zero bets.
    // Formula: 20 + 0.15×√1_800_000 = 20 + 201.2 = 221.2
    // PRD note says ≈82 which matches a different formula variant.
    // The IMPLEMENTED formula yields 221.2. Documented as PRD inconsistency.
    const b = adaptiveB(20, 30 * MS_PER_MIN, 0);
    expect(b).toBeCloseTo(221.2, 0);
    // This is NOT the PRD-stated 82. The discrepancy exists; formula is correct.
    expect(b).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// g) Closed-form binary price-impact formula validation
// ---------------------------------------------------------------------------

describe("(g) Closed-form binary price-impact validation", () => {
  /**
   * For a 50/50 binary (q=[0,0]), the closed-form post-bet price is:
   *
   *   p(Yes) = 1 − e^(−D/b) / 2
   *
   * where D = dollar amount bet and b = current liquidity parameter.
   * This follows from solving C(q=[Δ,0], b) − C(q=[0,0], b) = D analytically.
   */

  const CASES: Array<{ D: number; b: number; expectedPrice: number; label: string }> = [
    // b=20 cases (first-mover territory)
    { D: 10,  b: 20, expectedPrice: 1 - Math.exp(-10/20)/2,  label: "$10 at b=20" },
    { D: 20,  b: 20, expectedPrice: 1 - Math.exp(-20/20)/2,  label: "$20 at b=20 (~81.6¢)" },
    { D: 50,  b: 20, expectedPrice: 1 - Math.exp(-50/20)/2,  label: "$50 at b=20 (~95.9¢, not PRD's 92¢)" },
    // b=46 (30s, no volume)
    { D: 50,  b: 46, expectedPrice: 1 - Math.exp(-50/46)/2,  label: "$50 at b=46 (~83.1¢, matches PRD)" },
    // b=66 (30s, $100 volume)
    { D: 50,  b: 66, expectedPrice: 1 - Math.exp(-50/66)/2,  label: "$50 at b=66 (~76.5¢, close to PRD's 75¢)" },
    // Large b (stable market)
    { D: 50,  b: 200, expectedPrice: 1 - Math.exp(-50/200)/2, label: "$50 at b=200 (~58.8¢)" },
    { D: 50,  b: 500, expectedPrice: 1 - Math.exp(-50/500)/2, label: "$50 at b=500 (~52.5¢)" },
  ];

  for (const { D, b, expectedPrice, label } of CASES) {
    it(`closed-form matches binary search: ${label}`, () => {
      const q = [0, 0];
      const delta = computeSharesForDollarAmount(q, b, 0, D);
      const actualPrice = priceAfterPurchase(q, b, 0, delta)[0]!;
      // Closed-form and binary search should agree within 0.1¢.
      expect(Math.abs(actualPrice - expectedPrice)).toBeLessThan(0.002);
    });
  }

  it("PRD §4.3 table row 1 price: $50 at b=20 is 95.9¢ (not 92¢)", () => {
    // PRD §4.3 table row 1 claims 92¢. The correct value via formula is 95.9¢.
    const q = [0, 0];
    const b = 20;
    const delta = computeSharesForDollarAmount(q, b, 0, 50);
    const p = priceAfterPurchase(q, b, 0, delta)[0]!;
    expect(p).toBeCloseTo(0.959, 2);
    // Explicitly not 0.92.
    expect(Math.abs(p - 0.92)).toBeGreaterThan(0.02);
  });

  it("PRD §4.4 example: $20 at b=20 → Yes=81.6¢ (not PRD's 88¢)", () => {
    const q = [0, 0];
    const delta = computeSharesForDollarAmount(q, 20, 0, 20);
    const p = priceAfterPurchase(q, 20, 0, delta)[0]!;
    expect(p).toBeCloseTo(0.816, 2);
    expect(Math.abs(p - 0.88)).toBeGreaterThan(0.03);
  });

  it("price-impact formula shows diminishing returns: D/b is the key ratio", () => {
    // Doubling b halves the exponent → smaller price swing.
    const ratios = [0.5, 1, 2, 3, 5];
    let prevPrice = closedFormBinaryPrice(50, 50 / ratios[0]!);

    for (const ratio of ratios.slice(1)) {
      const b = 50 / ratio;
      // Larger ratio = smaller b = larger price swing.
      const p = closedFormBinaryPrice(50, b > 0 ? b : 1);
      if (ratio > ratios[0]!) {
        expect(p).toBeGreaterThanOrEqual(prevPrice);
        prevPrice = p;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// h) PRD §4.4 narrative b-value cross-check
// ---------------------------------------------------------------------------

describe("(h) PRD §4.4 narrative b-value cross-check", () => {
  /**
   * PRD §4.4 lists specific b values mid-example:
   *   t=0s,   V=$0  → b=20  ✓
   *   t=15s,  V=$20 → b=39  (formula gives 42.4) ✗
   *   t=45s,  V=$30 → b=56  (formula gives 57.8) ~✓
   *   t=2min, V=$45 → b=90  (formula gives 80.96) ✗
   *   t=5min, V=$95 → b=141 (formula gives 121.2) ✗
   *
   * The implemented formula is applied. PRD narrative values are cross-checked.
   */

  it("t=0, V=$0 → b=20 ✓", () => {
    expect(adaptiveB(20, 0, 0)).toBeCloseTo(20, 1);
  });

  it("t=15s, V=$20 → formula gives 42.4 (PRD says 39)", () => {
    // 20 + 0.15×√15000 + 0.2×20 = 20 + 18.37 + 4 = 42.37
    const b = adaptiveB(20, 15 * MS_PER_SEC, 20);
    expect(b).toBeCloseTo(42.37, 1);
    expect(Math.abs(b - 39)).toBeGreaterThan(2); // ≠ PRD's 39
  });

  it("t=45s, V=$30 → formula gives 57.8 (PRD says 56, close)", () => {
    // 20 + 0.15×√45000 + 0.2×30 = 20 + 31.82 + 6 = 57.82
    const b = adaptiveB(20, 45 * MS_PER_SEC, 30);
    expect(b).toBeCloseTo(57.82, 1);
    // Within ~3% of PRD's 56 — reasonably close.
    expect(Math.abs(b - 56)).toBeLessThan(3);
  });

  it("t=2min, V=$45 → formula gives 80.96 (PRD says 90)", () => {
    // 20 + 0.15×√120000 + 0.2×45 = 20 + 51.96 + 9 = 80.96
    const b = adaptiveB(20, 2 * MS_PER_MIN, 45);
    expect(b).toBeCloseTo(80.96, 1);
    expect(Math.abs(b - 90)).toBeGreaterThan(5); // ≠ PRD's 90
  });

  it("t=5min, V=$95 → formula gives 121.2 (PRD says 141)", () => {
    // 20 + 0.15×√300000 + 0.2×95 = 20 + 82.16 + 19 = 121.16
    const b = adaptiveB(20, 5 * MS_PER_MIN, 95);
    expect(b).toBeCloseTo(121.16, 1);
    expect(Math.abs(b - 141)).toBeGreaterThan(10); // ≠ PRD's 141
  });
});

// ---------------------------------------------------------------------------
// i) Numerical stability — large share counts and mixed-sign vectors
// ---------------------------------------------------------------------------

describe("(i) Numerical stability", () => {
  it("no overflow with q[i]=10000 and b=20 (massive share imbalance)", () => {
    const q = [10_000, 0];
    const prices = allPrices(q, 20);
    expect(Number.isFinite(prices[0]!)).toBe(true);
    expect(Number.isFinite(prices[1]!)).toBe(true);
    expect(prices[0]).toBeGreaterThan(0.999);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
  });

  it("no underflow with q[i]=-10000 and b=20", () => {
    const q = [-10_000, 0];
    const prices = allPrices(q, 20);
    expect(Number.isFinite(prices[0]!)).toBe(true);
    expect(prices[1]).toBeGreaterThan(0.999); // outcome 1 dominates
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
  });

  it("no overflow with b=0.1 (very small b)", () => {
    const q = [0, 0];
    // b must be > 0; minimum legal value is ~0.001.
    const prices = allPrices(q, 0.1);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
  });

  it("cost function is finite for q=[1000,1000,1000], b=5", () => {
    const c = costFunction([1000, 1000, 1000], 5);
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThan(0);
  });

  it("binary search converges with b=0.5 (sub-unit b)", () => {
    const delta = computeSharesForDollarAmount([0, 0], 0.5, 0, 0.1);
    expect(delta).toBeGreaterThan(0);
    expect(Number.isFinite(delta)).toBe(true);
    const qNew = [delta, 0];
    const costDiff = costFunction(qNew, 0.5) - costFunction([0, 0], 0.5);
    expect(Math.abs(costDiff - 0.1)).toBeLessThan(COST_TOL);
  });

  it("100-outcome market — prices sum to 1 (stress test)", () => {
    // Extreme case: 100 outcomes with random shares.
    const rand = lcg(99991);
    const q = Array.from({ length: 100 }, () => rand() * 100 - 50);
    const b = 50;
    const prices = allPrices(q, b);
    expect(prices).toHaveLength(100);
    expect(Math.abs(sum(prices) - 1)).toBeLessThan(PRICE_SUM_TOL);
    for (const p of prices) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(Number.isFinite(p)).toBe(true);
    }
  });
});
