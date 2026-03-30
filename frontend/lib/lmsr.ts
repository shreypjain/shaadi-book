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
// Default b parameter
// ---------------------------------------------------------------------------

/**
 * Sensible default liquidity parameter for a new market.
 *
 * Mirrors backend/src/services/lmsr.ts defaultB().
 * Targets p ≈ 0.95 when the leading outcome holds 80% of maxShares.
 *
 *   b = 0.8 × maxShares / ln(19 × (numOutcomes − 1))
 *
 * For a binary market with maxShares=100: b ≈ 27.2
 *
 * @param numOutcomes - Number of outcomes (≥ 2).
 * @param maxShares   - Per-outcome share cap (default 100).
 */
export function defaultB(numOutcomes: number, maxShares: number = 100): number {
  if (numOutcomes < 2) throw new Error("defaultB: numOutcomes must be >= 2");
  return (0.8 * maxShares) / Math.log(19 * (numOutcomes - 1));
}

// ---------------------------------------------------------------------------
// Dollar revenue from selling shares
// ---------------------------------------------------------------------------

/**
 * Compute the dollar revenue from selling a given number of shares.
 *
 * revenue = C(q_before) − C(q_after)
 * where q_after[i] = q_before[i] − sharesToSell
 *
 * Mirrors backend/src/services/lmsr.ts computeDollarAmountForShares().
 * Uses float64 (no Decimal.js) — sufficient precision for UI previews.
 *
 * @param q            - Current shares-sold vector (before the sale).
 * @param b            - Liquidity parameter.
 * @param outcomeIndex - Outcome whose shares are being sold.
 * @param sharesToSell - Number of shares to sell (must be > 0 and ≤ q[i]).
 * @returns Dollar amount received (rounded to 4 d.p.).
 */
export function computeDollarAmountForShares(
  q: number[],
  b: number,
  outcomeIndex: number,
  sharesToSell: number
): number {
  if (sharesToSell <= 0) {
    throw new Error("computeDollarAmountForShares: sharesToSell must be > 0");
  }
  if (outcomeIndex < 0 || outcomeIndex >= q.length) {
    throw new Error(
      `computeDollarAmountForShares: outcomeIndex ${outcomeIndex} out of range`
    );
  }
  const qi = q[outcomeIndex] ?? 0;
  if (sharesToSell > qi) {
    throw new Error(
      `computeDollarAmountForShares: cannot sell ${sharesToSell} shares, only ${qi} owned`
    );
  }
  const cBefore = costFunction(q, b);
  const qAfter = q.slice();
  qAfter[outcomeIndex] = qi - sharesToSell;
  const cAfter = costFunction(qAfter, b);
  const revenue = cBefore - cAfter;
  return Math.round(revenue * 10_000) / 10_000;
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
