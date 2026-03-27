/**
 * lmsr.ts — Client-side LMSR math for buy-form preview.
 *
 * Pure JS (no Decimal.js) — float64 precision is fine for display.
 * Mirrors the formulas in backend/src/services/lmsr.ts.
 */

// ---------------------------------------------------------------------------
// Cost function
// ---------------------------------------------------------------------------

/**
 * LMSR cost: C(q) = b × ln(Σ e^(q_i/b))
 * Uses log-sum-exp trick for numerical stability.
 */
export function costFunction(q: number[], b: number): number {
  if (q.length === 0) throw new Error("costFunction: q must be non-empty");
  if (b <= 0) throw new Error("costFunction: b must be positive");
  const max = Math.max(...q.map((qi) => qi / b));
  const sumExp = q.reduce((acc, qi) => acc + Math.exp(qi / b - max), 0);
  return b * (max + Math.log(sumExp));
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/**
 * Price of outcome i: p(i) = e^(q_i/b) / Σ e^(q_j/b)
 */
export function price(q: number[], b: number, outcomeIndex: number): number {
  const max = Math.max(...q.map((qi) => qi / b));
  const sumExp = q.reduce((acc, qi) => acc + Math.exp(qi / b - max), 0);
  return Math.exp(q[outcomeIndex]! / b - max) / sumExp;
}

/**
 * All prices at once.
 */
export function allPrices(q: number[], b: number): number[] {
  const max = Math.max(...q.map((qi) => qi / b));
  const exps = q.map((qi) => Math.exp(qi / b - max));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExp);
}

// ---------------------------------------------------------------------------
// Adaptive b
// ---------------------------------------------------------------------------

/**
 * b(t, V) = max(b_floor, 20 + (0.6 × 0.25 × √(dt_ms)) + (0.4 × 0.5 × V))
 */
export function adaptiveB(bFloor: number, dtMs: number, volumeDollars: number): number {
  const timePart = 0.6 * 0.25 * Math.sqrt(dtMs);
  const volPart = 0.4 * 0.5 * volumeDollars;
  return Math.max(bFloor, 20 + timePart + volPart);
}

// ---------------------------------------------------------------------------
// Binary search: shares given dollar amount
// ---------------------------------------------------------------------------

/**
 * Compute how many shares of outcome[outcomeIndex] you get for dollarAmount.
 * Binary searches for Δ such that C(q + Δ·e_i) - C(q) = dollarAmount.
 *
 * @returns { shares, avgPrice, priceBefore, priceAfter }
 */
export function computePreview(
  q: number[],
  b: number,
  outcomeIndex: number,
  dollarAmount: number
): {
  shares: number;
  avgPrice: number;
  priceBefore: number;
  priceAfter: number;
  allPricesAfter: number[];
} {
  const cBefore = costFunction(q, b);
  const target = cBefore + dollarAmount;
  const priceBefore = price(q, b, outcomeIndex);

  const costAtDelta = (delta: number): number => {
    const qNew = [...q];
    qNew[outcomeIndex] = (qNew[outcomeIndex] ?? 0) + delta;
    return costFunction(qNew, b);
  };

  // Expand hi until costAtDelta(hi) >= target
  let lo = 0;
  let hi = Math.max(dollarAmount, 1);
  while (costAtDelta(hi) < target) {
    hi *= 2;
  }

  // Binary search — 60 iterations gives precision < 1e-7
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const diff = costAtDelta(mid) - target;
    if (Math.abs(diff) < 1e-7) {
      lo = mid;
      hi = mid;
      break;
    }
    if (diff < 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const shares = (lo + hi) / 2;
  const qAfter = [...q];
  qAfter[outcomeIndex] = (qAfter[outcomeIndex] ?? 0) + shares;

  const priceAfter = price(qAfter, b, outcomeIndex);
  const avgPrice = shares > 0 ? dollarAmount / shares : priceBefore;
  const pricesAfter = allPrices(qAfter, b);

  return {
    shares,
    avgPrice,
    priceBefore,
    priceAfter,
    allPricesAfter: pricesAfter,
  };
}
