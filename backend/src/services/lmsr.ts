/**
 * LMSR (Logarithmic Market Scoring Rule) Pricing Engine
 *
 * Fixed 1000-shares-per-outcome model with buying and selling support.
 * Uses a closed-form analytical solution instead of binary search.
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
 * Derivation (let S = Σⱼ≠ᵢ e^(qⱼ/b), eᵢ = e^(qᵢ/b)):
 *   b·ln(S + eᵢ·e^(Δ/b)) − b·ln(S + eᵢ) = X
 *   e^(Δ/b) = (e^(X/b)·(S + eᵢ) − S) / eᵢ
 *   Δ = b·ln((e^(X/b)·(S + eᵢ) − S) / eᵢ)
 *
 * Precision: Decimal.js at 50 digits; result rounded to 4 decimal places.
 *
 * @param q            - Current shares-sold vector.
 * @param b            - Liquidity parameter.
 * @param outcomeIndex - Outcome being purchased.
 * @param dollarAmount - Dollar amount being spent (must be > 0).
 * @param maxShares    - Per-outcome share cap (default 100). Throws
 *                       SHARE_CAP_EXCEEDED if the purchase would breach it.
 * @returns Number of shares received (rounded to 4 d.p.).
 */
export function computeSharesForDollarAmount(
  q: number[],
  b: number,
  outcomeIndex: number,
  dollarAmount: number,
  maxShares: number = 1000
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
  const qi = new Decimal(q[outcomeIndex]!);
  const X = new Decimal(dollarAmount);

  // S = Σⱼ≠ᵢ e^(qⱼ/b)  — sum of exponentials for all outcomes except i.
  const S = q.reduce((acc: Decimal, qj, j) => {
    if (j === outcomeIndex) return acc;
    return acc.plus(new Decimal(qj).dividedBy(bd).exp());
  }, new Decimal(0));

  // eᵢ = e^(qᵢ/b)
  const ei = qi.dividedBy(bd).exp();

  // Δ = b × ln((e^(X/b) × (S + eᵢ) − S) / eᵢ)
  const eXb = X.dividedBy(bd).exp(); // e^(X/b)
  const numerator = eXb.times(S.plus(ei)).minus(S);
  const delta = bd.times(numerator.dividedBy(ei).ln());

  // Guard: reject before rounding if the purchase would breach the share cap.
  const newQi = qi.plus(delta).toNumber();
  if (newQi > maxShares) {
    const err = new Error(
      `SHARE_CAP_EXCEEDED: purchase would bring shares to ${newQi.toFixed(4)}, exceeding cap of ${maxShares}`
    );
    (err as Error & { code: string }).code = "SHARE_CAP_EXCEEDED";
    throw err;
  }

  return Math.round(delta.toNumber() * 10_000) / 10_000;
}

/**
 * Compute the dollar revenue from selling a given number of shares.
 *
 * revenue = C(q_before) − C(q_after)
 * where q_after[i] = q_before[i] − sharesToSell
 *
 * @param q            - Current shares-sold vector (before the sale).
 * @param b            - Liquidity parameter.
 * @param outcomeIndex - Outcome whose shares are being sold.
 * @param sharesToSell - Number of shares to sell (must be > 0 and ≤ qᵢ).
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

/**
 * Sensible default liquidity parameter for a new market.
 *
 * Derivation: targets p ≈ 0.95 when the leading outcome has sold 80% of
 * maxShares while all others remain at 0.
 *
 *   p(i) = e^(0.8·M/b) / (e^(0.8·M/b) + (n−1)) = 0.95
 *   ⟹  e^(0.8·M/b) = 19·(n−1)
 *   ⟹  b = 0.8·M / ln(19·(n−1))
 *
 * For a binary market with M=1000: b = 800/ln(19) ≈ 272
 *   p at q=(0,0):      0.50
 *   p at q=(500,0):   ~0.86
 *   p at q=(800,0):   ~0.95  ← target
 *   p at q=(1000,0):  ~0.98
 *
 * For a 3-outcome market with M=1000: b = 800/ln(38) ≈ 220
 *
 * @param numOutcomes - Number of outcomes (≥ 2).
 * @param maxShares   - Per-outcome share cap (default 1000).
 * @returns A b value calibrated for the given market shape.
 */
export function defaultB(numOutcomes: number, maxShares: number = 1000): number {
  if (numOutcomes < 2) throw new Error("defaultB: numOutcomes must be >= 2");
  return (0.8 * maxShares) / Math.log(19 * (numOutcomes - 1));
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
 * Worst-case theoretical house exposure for a market with the given parameters.
 *
 * max_loss = b × ln(n)
 *
 * NOTE: With capped parimutuel resolution (payout_per_share = min($1, pool/winning_shares))
 * the house never actually realises this loss in practice — this is a theoretical
 * maximum from the raw LMSR formula, displayed on the admin dashboard for monitoring.
 *
 * @param b           - Current liquidity parameter.
 * @param numOutcomes - Number of outcomes in the market (n ≥ 2).
 * @returns Theoretical maximum house loss in dollars.
 */
export function maxHouseExposure(b: number, numOutcomes: number): number {
  if (b <= 0) throw new Error("maxHouseExposure: b must be positive");
  if (numOutcomes < 2) {
    throw new Error("maxHouseExposure: numOutcomes must be >= 2");
  }
  return b * Math.log(numOutcomes);
}
