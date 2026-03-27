/**
 * LMSR (Logarithmic Market Scoring Rule) Pricing Engine
 *
 * Pure functions with zero DB dependency. All monetary values are in dollars
 * (the caller converts cents↔dollars at the transaction boundary).
 *
 * References:
 *   PRD §4.2 — cost function and price formula
 *   PRD §4.3 — adaptive b parameter
 *   PRD §6.3 — purchase engine pseudocode
 */

import { Decimal } from "decimal.js";

// High precision arithmetic to avoid accumulated float errors.
Decimal.set({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Log-sum-exp trick: ln(Σ eˣⁱ) = max(x) + ln(Σ e^(xᵢ - max(x)))
 *
 * Prevents overflow/underflow when exponents span a wide range.
 */
function logSumExp(vals: Decimal[]): Decimal {
  if (vals.length === 0) throw new Error("logSumExp: empty array");

  const maxVal = vals.reduce((a, b) => (a.greaterThan(b) ? a : b));
  const sumShifted = vals.reduce(
    (acc, v) => acc.plus(v.minus(maxVal).exp()),
    new Decimal(0)
  );
  return maxVal.plus(sumShifted.ln());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * C(q) = b × ln(Σ e^(qᵢ/b))
 *
 * The LMSR cost function. Represents the total payout the house would owe
 * if shares paid out at their current price.
 *
 * @param q - Shares-sold vector (one entry per outcome). Units: shares.
 * @param b - Liquidity parameter. Larger b → smaller price impact per trade.
 * @returns Cost in the same units as b (dollars if b is in dollars).
 */
export function costFunction(q: number[], b: number): number {
  if (q.length === 0) throw new Error("costFunction: q must be non-empty");
  if (b <= 0) throw new Error("costFunction: b must be positive");

  const bd = new Decimal(b);
  const scaled = q.map((qi) => new Decimal(qi).dividedBy(bd));
  return bd.times(logSumExp(scaled)).toNumber();
}

/**
 * p(i) = e^(qᵢ/b) / Σ e^(qⱼ/b)
 *
 * Spot price of a single outcome. Equivalent to the implied probability.
 *
 * @param q            - Shares-sold vector.
 * @param b            - Liquidity parameter.
 * @param outcomeIndex - Index of the outcome to price (0-based).
 * @returns Price in [0, 1].
 */
export function price(q: number[], b: number, outcomeIndex: number): number {
  if (outcomeIndex < 0 || outcomeIndex >= q.length) {
    throw new Error(
      `price: outcomeIndex ${outcomeIndex} out of range [0, ${q.length})`
    );
  }
  return allPrices(q, b)[outcomeIndex]!;
}

/**
 * Returns the spot price for every outcome.
 * Guaranteed: all values in (0,1) and they sum to exactly 1.
 *
 * @param q - Shares-sold vector.
 * @param b - Liquidity parameter.
 * @returns Array of prices, one per outcome, summing to 1.
 */
export function allPrices(q: number[], b: number): number[] {
  if (q.length === 0) throw new Error("allPrices: q must be non-empty");
  if (b <= 0) throw new Error("allPrices: b must be positive");

  const bd = new Decimal(b);
  const scaled = q.map((qi) => new Decimal(qi).dividedBy(bd));

  // Softmax via log-sum-exp for numerical stability.
  const maxVal = scaled.reduce((a, v) => (a.greaterThan(v) ? a : v));
  const shifted = scaled.map((v) => v.minus(maxVal).exp());
  const sumShifted = shifted.reduce((acc, e) => acc.plus(e), new Decimal(0));

  return shifted.map((e) => e.dividedBy(sumShifted).toNumber());
}

/**
 * Binary search: find Δ shares such that
 *   C(q₁, …, qᵢ + Δ, …, qₙ) − C(q₁, …, qₙ) = dollarAmount
 *
 * Precision: converges to within 1e-7; result is rounded to 4 decimal places.
 *
 * @param q            - Current shares-sold vector.
 * @param b            - Liquidity parameter.
 * @param outcomeIndex - Outcome being purchased.
 * @param dollarAmount - Dollar amount being spent (must be > 0).
 * @returns Number of shares received (rounded to 4 d.p.).
 */
export function computeSharesForDollarAmount(
  q: number[],
  b: number,
  outcomeIndex: number,
  dollarAmount: number
): number {
  if (dollarAmount <= 0) {
    throw new Error("computeSharesForDollarAmount: dollarAmount must be > 0");
  }
  if (outcomeIndex < 0 || outcomeIndex >= q.length) {
    throw new Error(
      `computeSharesForDollarAmount: outcomeIndex ${outcomeIndex} out of range`
    );
  }

  const cBefore = costFunction(q, b);
  const target = cBefore + dollarAmount;

  /** Cost of the state vector after buying `delta` additional shares. */
  const costAtDelta = (delta: number): number => {
    const qNew = q.slice();
    qNew[outcomeIndex] = (q[outcomeIndex] ?? 0) + delta;
    return costFunction(qNew, b);
  };

  // Expand upper bound until cost(hi) > target.
  let lo = 0;
  let hi = Math.max(dollarAmount, 1);
  while (costAtDelta(hi) < target) {
    hi *= 2;
  }

  // Bisection — 200 iterations gives precision << 1e-7 for any reasonable range.
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const diff = costAtDelta(mid) - target;

    if (Math.abs(diff) < 1e-7) break;

    if (diff < 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Round to 4 decimal places as required.
  return Math.round(((lo + hi) / 2) * 10_000) / 10_000;
}

/**
 * Adaptive liquidity parameter.
 *
 * b(t, V) = max(bFloor, 20 + (0.6 × 0.25 × √(Δt_ms)) + (0.4 × 0.5 × V))
 *
 * The hybrid time/volume formula ensures markets are price-sensitive early
 * (driving excitement) and stabilise as both time and money flow in.
 *
 * @param bFloor      - Minimum allowed b (default 20; admin-configurable per market).
 * @param dtMs        - Milliseconds elapsed since the market opened.
 * @param totalVolume - Total dollar volume traded in this market so far.
 * @returns The current b value (≥ bFloor).
 */
export function adaptiveB(
  bFloor: number,
  dtMs: number,
  totalVolume: number
): number {
  if (bFloor <= 0) throw new Error("adaptiveB: bFloor must be positive");
  if (dtMs < 0) throw new Error("adaptiveB: dtMs must be >= 0");
  if (totalVolume < 0) throw new Error("adaptiveB: totalVolume must be >= 0");

  const computed =
    20 + 0.6 * 0.25 * Math.sqrt(dtMs) + 0.4 * 0.5 * totalVolume;
  return Math.max(bFloor, computed);
}

/**
 * Returns the new spot prices for all outcomes after a purchase has been made.
 *
 * Convenience wrapper: applies the share delta and calls allPrices.
 *
 * @param q            - Shares-sold vector before the purchase.
 * @param b            - Liquidity parameter at the time of the purchase.
 * @param outcomeIndex - Outcome that was purchased.
 * @param shares       - Number of shares purchased (Δ from computeSharesForDollarAmount).
 * @returns Updated price array, one per outcome, summing to 1.
 */
export function priceAfterPurchase(
  q: number[],
  b: number,
  outcomeIndex: number,
  shares: number
): number[] {
  if (outcomeIndex < 0 || outcomeIndex >= q.length) {
    throw new Error(
      `priceAfterPurchase: outcomeIndex ${outcomeIndex} out of range`
    );
  }
  if (shares < 0) throw new Error("priceAfterPurchase: shares must be >= 0");

  const qNew = q.slice();
  qNew[outcomeIndex] = (q[outcomeIndex] ?? 0) + shares;
  return allPrices(qNew, b);
}

/**
 * Worst-case house exposure for a market with the given parameters.
 *
 * max_loss = b × ln(n)
 *
 * This is the maximum possible net payout the house could owe if one outcome
 * captures all the liquidity. Displayed on the admin dashboard in real-time.
 *
 * @param b           - Current liquidity parameter.
 * @param numOutcomes - Number of outcomes in the market (n ≥ 2).
 * @returns Maximum possible house loss in dollars.
 */
export function maxHouseExposure(b: number, numOutcomes: number): number {
  if (b <= 0) throw new Error("maxHouseExposure: b must be positive");
  if (numOutcomes < 2) {
    throw new Error("maxHouseExposure: numOutcomes must be >= 2");
  }
  return b * Math.log(numOutcomes);
}
