/**
 * LMSR (Logarithmic Market Scoring Rule) Pricing Engine
 *
 * Pure functions with zero DB dependency. All monetary values are in dollars
 * (the caller converts cents↔dollars at the transaction boundary).
 *
 * References:
 *   PRD §4.2 — cost function and price formula
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
 * Closed-form solution: find Δ shares such that
 *   C(q₁, …, qᵢ + Δ, …, qₙ) − C(q₁, …, qₙ) = dollarAmount
 *
 * Derivation:
 *   Let S = Σⱼ≠ᵢ e^(qⱼ/b)
 *   C(q_after) - C(q_before) = X  →  solve for Δ:
 *   Δ = b × ln((e^(X/b) × (S + e^(qᵢ/b)) - S) / e^(qᵢ/b))
 *
 * Precision: exact to Decimal.js precision; result is rounded to 4 d.p.
 *
 * @param q            - Current shares-sold vector.
 * @param b            - Liquidity parameter.
 * @param outcomeIndex - Outcome being purchased.
 * @param dollarAmount - Dollar amount being spent (must be > 0).
 * @param maxShares    - Maximum shares allowed per outcome (default 100).
 * @returns Number of shares received (rounded to 4 d.p.).
 */
export function computeSharesForDollarAmount(
  q: number[],
  b: number,
  outcomeIndex: number,
  dollarAmount: number,
  maxShares: number = 100
): number {
  if (dollarAmount <= 0) {
    throw new Error("computeSharesForDollarAmount: dollarAmount must be > 0");
  }
  if (outcomeIndex < 0 || outcomeIndex >= q.length) {
    throw new Error(
      `computeSharesForDollarAmount: outcomeIndex ${outcomeIndex} out of range`
    );
  }

  const bd = new Decimal(b);
  const X = new Decimal(dollarAmount);
  const qi = new Decimal(q[outcomeIndex] ?? 0);

  // S = Σⱼ≠ᵢ e^(qⱼ/b)
  const S = q.reduce((acc, qj, j) => {
    if (j === outcomeIndex) return acc;
    return acc.plus(new Decimal(qj).dividedBy(bd).exp());
  }, new Decimal(0));

  const eQi = qi.dividedBy(bd).exp();

  // Δ = b × ln((e^(X/b) × (S + e^(qᵢ/b)) - S) / e^(qᵢ/b))
  const eXb = X.dividedBy(bd).exp();
  const numerator = eXb.times(S.plus(eQi)).minus(S);
  const delta = bd.times(numerator.dividedBy(eQi).ln());

  const deltaNum = delta.toDecimalPlaces(4, Decimal.ROUND_DOWN).toNumber();

  if ((q[outcomeIndex] ?? 0) + deltaNum > maxShares) {
    throw new Error(
      `computeSharesForDollarAmount: purchase would exceed maxShares (${maxShares}). ` +
        `Current: ${q[outcomeIndex]}, buying: ${deltaNum}`
    );
  }

  return deltaNum;
}

/**
 * Revenue from selling shares back to the AMM.
 *
 * Revenue = C(q_before) - C(q_after)
 * where q_after[outcomeIndex] = q_before[outcomeIndex] - sharesToSell
 *
 * @param q            - Current shares-sold vector (before the sale).
 * @param b            - Liquidity parameter.
 * @param outcomeIndex - Outcome being sold.
 * @param sharesToSell - Number of shares to sell (must be > 0 and ≤ q[i]).
 * @returns Dollar revenue received (rounded to 4 d.p.).
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
  const currentShares = q[outcomeIndex] ?? 0;
  if (sharesToSell > currentShares) {
    throw new Error(
      `computeDollarAmountForShares: cannot sell ${sharesToSell} shares — only ${currentShares} held`
    );
  }

  const qAfter = q.slice();
  qAfter[outcomeIndex] = currentShares - sharesToSell;

  const revenue = costFunction(q, b) - costFunction(qAfter, b);
  return Math.round(revenue * 10_000) / 10_000;
}

/**
 * Default fixed liquidity parameter for a market.
 *
 * b = maxShares / ln(19^(numOutcomes - 1))
 *
 * Calibrated so that betting the entire supply on one outcome costs roughly
 * maxShares dollars more than an equal-weight starting state.
 *
 * Typical values (maxShares = 100):
 *   n=2: ≈ 33.95   n=3: ≈ 16.98   n=4: ≈ 11.32
 *
 * @param numOutcomes - Number of outcomes in the market (≥ 2).
 * @param maxShares   - Maximum shares per outcome (default 100).
 * @returns Fixed b value for the market.
 */
export function defaultB(numOutcomes: number, maxShares: number = 100): number {
  if (numOutcomes < 2) throw new Error("defaultB: numOutcomes must be >= 2");
  if (maxShares <= 0) throw new Error("defaultB: maxShares must be positive");
  return maxShares / Math.log(Math.pow(19, numOutcomes - 1));
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
