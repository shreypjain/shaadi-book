# LMSR Research Report — Shaadi Book Prediction Market

**Prepared by:** Quantitative analysis of `backend/src/services/lmsr.ts`  
**Reference tests:** `backend/src/services/__tests__/lmsr-research.test.ts` (60 tests, all passing)  
**PRD sections examined:** §4.2, §4.3, §4.4

---

## 1. Executive Summary

The LMSR implementation in `lmsr.ts` is **mathematically correct** and **numerically robust**. The log-sum-exp trick prevents overflow/underflow across all tested parameter ranges, the binary search solver converges reliably (200 iterations, precision < 1e-7), and prices always sum to exactly 1.0. No bugs were found in the production code.

**However, the PRD contains systematic inaccuracies** in both the §4.3 adaptive-b table and the §4.4 pricing narrative. These are documentation errors, not code bugs. The implemented formula (which matches CLAUDE.md) is the ground truth.

Additionally, the adaptive b formula is **moderately well-calibrated** for the wedding context but has **one notable issue**: early markets are more volatile than the PRD describes, which is actually *desirable* for the product but should be correctly communicated.

---

## 2. Cost Function Verification

### 2.1 Formula

`C(q) = b × ln(Σ e^(qᵢ/b))`

### 2.2 Implementation Verdict: ✅ Correct

| Property | Expected | Observed |
|---|---|---|
| Prices sum to 1.0 | Always | ✅ (tolerance < 1e-4) |
| Prices in (0, 1) | Always (or [0,1] at extremes) | ✅ |
| C monotonically increasing | Yes | ✅ |
| Cost = C(q+Δeᵢ) − C(q) | = dollar spent | ✅ (< $0.01 error) |
| Numerical stability | Finite at all tested ranges | ✅ |

### 2.3 Numerical Stability

The **log-sum-exp trick** (`max(x) + ln(Σ eˣⁱ⁻ᵐᵃˣ)`) is correctly applied in both `logSumExp()` and `allPrices()`. Tested successfully at:

- `q[i] = 10,000` with `b = 20` — no overflow
- `q[i] = -10,000` with `b = 20` — no underflow
- `b = 0.1` (sub-unit) — stable
- `b = 10,000` — stable
- 100-outcome market — prices sum to 1.0

### 2.4 Binary Search Solver

The solver expands the upper bound geometrically (`hi *= 2`) and bisects 200 times, achieving precision well below 1e-7. Results are rounded to 4 decimal places as specified.

**Convergence verified at:** b ∈ [0.5, 10,000], dollar amounts ∈ [$0.10, $50], market sizes 2–100 outcomes.

---

## 3. Adaptive b Formula Analysis

### 3.1 Formula (as implemented)

```
b(t, V) = max(b_floor, 20 + 0.15 × √(Δt_ms) + 0.2 × V)
         = max(b_floor, 20 + (0.6 × 0.25 × √(Δt_ms)) + (0.4 × 0.5 × V))
```

### 3.2 Growth Rate Table — Formula vs PRD §4.3

The formula generates the following b values. PRD table values shown for comparison.

| Market age | Volume | **Formula b** | PRD table b | Status |
|---|---|---|---|---|
| 0 sec | $0 | **20.0** | 20 | ✅ Match |
| 30 sec | $0 | **46.0** | 46 | ✅ Match |
| 30 sec | $100 | **66.0** | 66 | ✅ Match |
| 2 min | $200 | **112.0** | 106 | ❌ PRD wrong (+5.7%) |
| 5 min | $500 | **202.2** | 182 | ❌ PRD wrong (+11.1%) |
| 15 min | $1,000 | **362.3** | 447 | ❌ PRD wrong (−19.0%) |
| 30 min | $2,000 | **621.2** | 661 | ❌ PRD wrong (−5.9%) |
| 1 hr | $1,000 | **504.6** | — | — |
| 2 hr | $2,000 | **821.9** | — | — |
| 24 hr | $10,000 | **3,414** | — | — |

The first three rows match. Rows 4–7 diverge significantly and in inconsistent directions, suggesting the PRD table was generated with a different internal formula version. **The code is correct; the PRD table is not.**

The PRD §4.3 prose note ("30 min with zero bets → b ≈ 82") also diverges: the formula gives **221.2**, not 82. This is another PRD documentation error.

### 3.3 b Growth Decomposition

b has two additive components:

| Component | Formula | Character |
|---|---|---|
| Time | `0.15 × √(Δt_ms)` | Sub-linear (square root) — diminishing returns over time |
| Volume | `0.2 × V` | Linear — each additional dollar adds a fixed 20¢ to b |

At low volume, **time dominates**: the time component at 5 min ($82.2) dwarfs the volume component at $100 volume ($20). Only above ~$400 volume does volume begin to close the gap with the time component.

### 3.4 Extreme Values

| Scenario | b value | Max binary loss |
|---|---|---|
| t=0, V=0 (fresh market) | 20 | $13.9 |
| t=5min, V=$500 | 202 | $140 |
| t=1hr, V=$1,000 | 505 | $350 |
| t=2hr, V=$2,000 | 822 | $570 |
| t=24hr, V=$10,000 | 3,414 | $2,366 |

The 24-hr / $10K extreme is well outside the wedding scenario scope (2–3 hr event, ≤$5K per market). No overflow or numerical issues at any extreme.

---

## 4. Price Impact Analysis

### 4.1 Closed-Form Binary Price Impact

For a 50/50 binary market (`q=[0,0]`), after a single $D bet at liquidity b:

```
p(Yes) = 1 − e^(−D/b) / 2
```

This closed-form is derivable analytically and matches the binary search solver to within 0.2¢ across all tested cases. It provides an exact, fast way to reason about price impact without simulation.

**Key insight:** price impact ≈ `D/(2b)` for small `D/b` (linear approximation). Doubling b halves the price swing from any fixed bet.

### 4.2 PRD §4.3 Table — Price Impact Cross-Check

| b | $50 bet: PRD claimed price | **Actual (formula)** | Status |
|---|---|---|---|
| 20 | 92¢ | **95.9¢** | ❌ PRD wrong (3.9¢ low) |
| 46 | 83¢ | **83.1¢** | ✅ Match |
| 66 | 75¢ | **76.5¢** | ✅ Close (~1.5¢) |
| 106* | 66¢ | **68.2¢** (at b=112) | ✅ Close (≈2¢) |
| 182* | 60¢ | **62.1¢** (at b=202) | ✅ Close (≈2¢) |

\* These rows use the PRD's b values, not the formula-correct b values.

The **first row is the only material error**: at `b=20`, a $50 bet swings the market from 50¢ to **95.9¢**, not 92¢ as the PRD states. The actual first-mover impact is even more dramatic than advertised — which is fine for the product.

### 4.3 PRD §4.4 Narrative — b-Value Cross-Check

The §4.4 pricing walkthrough also uses b values that don't match the formula:

| t | V | PRD b | **Formula b** |
|---|---|---|---|
| 0s | $0 | 20 | **20** ✅ |
| 15s | $20 | 39 | **42.4** ❌ |
| 45s | $30 | 56 | **57.8** ~✅ |
| 2min | $45 | 90 | **81.0** ❌ |
| 5min | $95 | 141 | **121.2** ❌ |

The §4.4 b values appear to have been hand-tuned to produce the desired narrative price levels rather than computed from the formula.

---

## 5. Calibration Assessment for the Wedding Context

**Scenario:** ~100 guests, $50 max per market, 10–20 markets, 2–3 hour event.

### 5.1 Expected Market Trajectory

For a popular market receiving $1,000–$2,000 in total volume over 90 minutes:

```
t=0s:    b=20   → first $50 bet: 50¢ → 96¢  (massive first-mover edge)
t=30s:   b=46   → next $50 bet: 50¢ → 83¢   (still exciting)
t=2min:  b=112  → $50 bet: 50¢ → 68¢        (market maturing)
t=15min: b=362  → $50 bet: 50¢ → 57¢        (stable, late-mover pays fair)
t=60min: b=505  → $50 bet: 50¢ → 55¢        (effectively settled)
t=90min: b=621  → $50 bet: 50¢ → 54¢        (market hardened)
```

### 5.2 Is b_floor=20 Too Volatile?

**Assessment: Volatile by design, and appropriate.**

At `b=20`, a $50 bet from 50/50 swings the market to **95.9¢**. This is more extreme than the PRD suggests (92¢), but that's intentional: early-mover incentive is the core excitement mechanic. The PRD §4.4 narrative explicitly says "early movers are disproportionately rewarded."

One concern: if two guests simultaneously place $50 bets in opposite directions within the first few seconds, the price path is highly dependent on execution order (whoever lands first sets a 96¢ price, and the second person gets to bet the other side cheaply). This is correct LMSR behavior and creates interesting strategic dynamics, but may surprise guests.

**Verdict:** `b_floor=20` is appropriate. If the admin wants more sedate markets, they can set `b_floor=40` per-market to limit first-mover impact to ~88¢.

### 5.3 Does the 60/40 Time/Volume Weighting Make Sense?

**Assessment: Reasonable, with a time-dominance quirk.**

At low volume, time dominates heavily. A market open for 5 minutes with $0 volume has `b=102.2` — already fairly stable even with no trades. This means:

- ✅ Markets don't stay manipulable just because nobody bet yet (good)
- ⚠️ An admin who opens a market 5 minutes before an event starts will find the market already "hardened" before the event begins, reducing first-mover excitement

For the wedding use case, markets should ideally be opened **at the moment the event begins**, not in advance. If opened in advance, consider using `b_floor` override to set a higher floor that ensures even late-opening guests can still move the market.

**Alternative weights considered:**

| Weighting | At 5min/$500 | Effect |
|---|---|---|
| 70/30 (more time) | b=212 | Marginally more stable |
| 60/40 (current) | b=202 | Balanced |
| 50/50 (equal) | b=192 | Marginally more volume-responsive |
| 30/70 (more volume) | b=172 | Volume fast-tracks maturity more |

The differences are small. The 60/40 split is defensible. **No change recommended.**

### 5.4 B-Induced Price Drift (Important Observation)

As `b` grows between trades, the current price changes **even without any new bets**. Given `q=[Δ_yes, 0]` with Δ_yes shares of Yes:

```
p(Yes) at b=20: 95.9¢  (just after the first $50 bet)
p(Yes) at b=46: 82.9¢  (30 seconds later, no new trades)
p(Yes) at b=112: 67.8¢  (2 minutes later, no new trades)
```

The first bettor's implied probability decreases over time — their early bet looks less certain as the market matures. This is a **feature, not a bug**: it accurately reflects that a single early bet is not strong evidence once the market has had time to discover true prices. However, the UI should **not show users a "you bought at X¢, now worth Y¢" unrealised P&L** based on spot price alone, since drift would confuse guests who see their position value change with no new activity.

### 5.5 House Exposure

```
Max binary exposure  = b × ln(2)
Max 5-outcome exposure = b × ln(5)  (≈2.32× binary)

At b=20 (open):    binary $13.9  |  5-outcome $32.2
At b=362 (15min):  binary $251   |  5-outcome $583
At b=621 (30min):  binary $430   |  5-outcome $999
```

Exposure grows proportionally to b. Because b grows with both time and volume, the house's worst-case loss grows as the market matures. This is inherent to LMSR with adaptive b. The 20% charity fee provides a buffer, but the house **is genuinely exposed** on popular markets.

For a market with $2,000 volume over 30 minutes, worst-case house loss ≈ $430 (binary) or $999 (5-outcome). Since the house collects $2,000 but could owe ~$1,600 in payouts (80% of shares × $1), the maximum net house loss is around $600 for a 5-outcome market in the most extreme single-outcome sweep scenario.

---

## 6. Findings Summary

### 6.1 Bugs Found: None

The production code (`lmsr.ts`) is correct. All formulas match §4.2 specifications. No numerical issues found across extreme parameters.

### 6.2 PRD Documentation Errors Found: 5

| Location | Error | Severity |
|---|---|---|
| §4.3 table rows 4–7 | b values don't match the documented formula | Medium |
| §4.3 table row 1 price | Claims $50@b=20 → 92¢, actual is 95.9¢ | Low |
| §4.3 prose | "30min no-volume → b≈82", formula gives 221 | Medium |
| §4.4 b values (3 of 5 rows) | b values don't match formula | Low |
| §4.4 price for Guest A | Claims $20@b=20 → 88¢, actual is 81.6¢ | Low |

These are documentation errors and do not affect the running system.

### 6.3 Recommendations

| Priority | Recommendation | Rationale |
|---|---|---|
| **High** | Update PRD §4.3 table with formula-correct values | Avoid future confusion in audits |
| **High** | Update PRD §4.4 example with computed values | Code/docs parity |
| **Medium** | Document b-induced price drift in UX spec | Prevent confusing "my value changed with no trades" UI |
| **Medium** | Admin guidance: open markets at event start, not in advance | Maximise first-mover excitement |
| **Low** | Consider `b_floor=30` as default instead of 20 | Reduces first bet from 96¢ → 92¢, closer to PRD's stated intent |
| **Low** | Add real-time house exposure to admin dashboard | Exposure grows with b; important for risk monitoring |

---

## 7. Scenario Tables

### 7.1 Binary Market Price Path — 20 Alternating Bets (30s interval, $5–$50)

Simulated in `lmsr-research.test.ts § (a)`. Key observations verified:

- Prices always sum to 1.0 ✅
- b monotonically non-decreasing ✅  
- Early bet swings > late bet swings ✅ (market hardening confirmed)
- Each purchase moves price toward bought outcome ✅
- Cost reconstruction accurate to < $0.01 ✅

### 7.2 Price Impact at Different b Levels (binary, 50/50 start)

```
D (bet) │ b=20  │ b=46  │ b=66  │ b=112 │ b=202 │ b=362 │ b=621
────────┼───────┼───────┼───────┼───────┼───────┼───────┼───────
 $5     │ 62.9¢ │ 55.5¢ │ 53.8¢ │ 52.2¢ │ 51.2¢ │ 50.7¢ │ 50.4¢
$10     │ 73.1¢ │ 60.2¢ │ 57.1¢ │ 54.4¢ │ 52.5¢ │ 51.4¢ │ 50.8¢
$20     │ 81.6¢ │ 67.0¢ │ 63.3¢ │ 58.6¢ │ 54.9¢ │ 52.8¢ │ 51.6¢
$50     │ 95.9¢ │ 83.1¢ │ 76.5¢ │ 68.2¢ │ 62.1¢ │ 57.0¢ │ 54.0¢
```

Formula used: `p = 1 − e^(−D/b)/2` (exact closed-form for 50/50 binary).

### 7.3 House Max Exposure by Market Type

```
b value │ Binary (ln 2) │ 3-outcome (ln 3) │ 5-outcome (ln 5)
────────┼───────────────┼──────────────────┼─────────────────
    20  │      $13.9    │      $22.0       │      $32.2
    50  │      $34.7    │      $54.9       │      $80.5
   100  │      $69.3    │     $109.9       │     $160.9
   202  │     $140.1    │     $221.9       │     $325.1
   362  │     $251.0    │     $397.7       │     $582.6
   621  │     $430.5    │     $682.0       │     $999.1
 3,414  │   $2,366.0    │   $3,749.0       │   $5,494.0
```

### 7.4 Adaptive b Growth — Time Only (V=$0)

```
Time     │  b (formula)  │ Time component │ Notes
─────────┼───────────────┼────────────────┼────────────────────────
  0 sec  │    20.0       │      0.0       │ Floor
 30 sec  │    46.0       │     26.0       │ +26 from 30s
  2 min  │    51.9       │     31.9       │ +5.9 from 30s to 2min
  5 min  │   102.2       │     82.2       │ First mover still potent
 15 min  │   162.3       │    142.3       │ Stable
 30 min  │   221.2       │    201.2       │ Hardened
  1 hr   │   304.6       │    284.6       │
  2 hr   │   421.9       │    401.9       │
```

The square-root growth means time hardening provides a large early boost but diminishing returns beyond 30 minutes.

---

## 8. Conclusion

The LMSR implementation is production-ready. The math is correct, numerically stable, and correctly calibrated for a small, high-energy wedding prediction market. The core design choices — aggressive early-mover pricing (`b_floor=20`), hybrid time/volume hardening, and `b × ln(n)` house exposure — are all internally consistent.

The main actionable items are:
1. **Fix the PRD documentation** to use formula-correct values
2. **Educate the UX team** about b-induced price drift (prices move without trades)
3. **Monitor house exposure** on the admin dashboard as markets mature
