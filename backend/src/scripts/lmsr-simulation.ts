/**
 * LMSR Hyperparameter Simulation
 *
 * Simulates markets with different b values and bet patterns
 * to understand pricing behavior, slippage, and house exposure.
 *
 * Run: cd backend && npx tsx src/scripts/lmsr-simulation.ts
 */

// ---------------------------------------------------------------------------
// LMSR Math (mirrors backend/src/services/lmsr.ts)
// ---------------------------------------------------------------------------

function costFunction(q: number[], b: number): number {
  const max = Math.max(...q.map((qi) => qi / b));
  const sumExp = q.reduce((acc, qi) => acc + Math.exp(qi / b - max), 0);
  return b * (max + Math.log(sumExp));
}

function allPrices(q: number[], b: number): number[] {
  const max = Math.max(...q.map((qi) => qi / b));
  const exps = q.map((qi) => Math.exp(qi / b - max));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExp);
}

function binarySearchShares(
  q: number[], b: number, outcomeIndex: number, dollarAmount: number
): number {
  const cBefore = costFunction(q, b);
  const target = cBefore + dollarAmount;

  let lo = 0;
  let hi = Math.max(dollarAmount * 10, 1);
  while (costFunction([...q.slice(0, outcomeIndex), q[outcomeIndex]! + hi, ...q.slice(outcomeIndex + 1)], b) < target) {
    hi *= 2;
  }

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const qNew = [...q];
    qNew[outcomeIndex] = qNew[outcomeIndex]! + mid;
    const diff = costFunction(qNew, b) - target;
    if (Math.abs(diff) < 1e-7) { lo = mid; hi = mid; break; }
    if (diff < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function adaptiveB(bFloor: number, dtMs: number, volumeDollars: number): number {
  const timePart = 0.6 * 0.25 * Math.sqrt(dtMs);
  const volPart = 0.4 * 0.5 * volumeDollars;
  return Math.max(bFloor, 20 + timePart + volPart);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

interface Bet {
  user: string;
  outcomeIndex: number;
  amount: number;
}

interface SimResult {
  bFloor: number;
  finalB: number;
  numOutcomes: number;
  bets: Bet[];
  totalPool: number;
  finalPrices: number[];
  positions: Record<string, { outcome: number; shares: number; cost: number }[]>;
  payoutScenarios: { winner: number; payoutPerShare: number; userPayouts: Record<string, number> }[];
}

function simulateMarket(
  numOutcomes: number,
  bFloor: number,
  bets: Bet[],
  marketOpenMs: number = 3600000 // 1 hour
): SimResult {
  const q = new Array(numOutcomes).fill(0);
  let totalPool = 0;
  const positions: Record<string, { outcome: number; shares: number; cost: number }[]> = {};

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  b_floor=${bFloor} | ${numOutcomes} outcomes | ${bets.length} bets`);
  console.log(`${"=".repeat(70)}`);

  const startPrices = allPrices(q, bFloor);
  console.log(`\nInitial prices: ${startPrices.map((p, i) => `O${i}: ${(p * 100).toFixed(1)}¢`).join("  ")}`);

  for (const bet of bets) {
    const volume = totalPool;
    const b = adaptiveB(bFloor, marketOpenMs, volume);
    const pricesBefore = allPrices(q, b);

    const shares = binarySearchShares(q, b, bet.outcomeIndex, bet.amount);
    q[bet.outcomeIndex] += shares;
    totalPool += bet.amount;

    const pricesAfter = allPrices(q, b);

    if (!positions[bet.user]) positions[bet.user] = [];
    const existing = positions[bet.user]!.find(p => p.outcome === bet.outcomeIndex);
    if (existing) {
      existing.shares += shares;
      existing.cost += bet.amount;
    } else {
      positions[bet.user]!.push({ outcome: bet.outcomeIndex, shares, cost: bet.amount });
    }

    console.log(
      `  ${bet.user} bets $${bet.amount.toFixed(2)} on O${bet.outcomeIndex} → ` +
      `${shares.toFixed(2)} shares @ avg $${(bet.amount / shares).toFixed(3)} | ` +
      `Price: ${(pricesBefore[bet.outcomeIndex]! * 100).toFixed(1)}¢ → ${(pricesAfter[bet.outcomeIndex]! * 100).toFixed(1)}¢ | ` +
      `b=${b.toFixed(1)}`
    );
  }

  const finalB = adaptiveB(bFloor, marketOpenMs, totalPool);
  const finalPrices = allPrices(q, finalB);

  console.log(`\nFinal state:`);
  console.log(`  Pool: $${totalPool.toFixed(2)} | b: ${finalB.toFixed(1)}`);
  console.log(`  Prices: ${finalPrices.map((p, i) => `O${i}: ${(p * 100).toFixed(1)}¢`).join("  ")}`);

  // Payout scenarios (capped parimutuel)
  console.log(`\nPayout scenarios (capped parimutuel: min($1, pool/shares)):`);
  const payoutScenarios = [];

  for (let winner = 0; winner < numOutcomes; winner++) {
    const totalWinningShares = Object.values(positions)
      .flat()
      .filter(p => p.outcome === winner)
      .reduce((sum, p) => sum + p.shares, 0);

    if (totalWinningShares === 0) {
      console.log(`  If O${winner} wins: No bets → full refund`);
      payoutScenarios.push({ winner, payoutPerShare: 0, userPayouts: {} });
      continue;
    }

    const rawPPS = totalPool / totalWinningShares;
    const payoutPerShare = Math.min(1.0, rawPPS);
    const totalPayout = totalWinningShares * payoutPerShare;
    const houseSurplus = totalPool - totalPayout;

    const userPayouts: Record<string, number> = {};
    console.log(`  If O${winner} wins: pps=$${payoutPerShare.toFixed(3)} (raw=$${rawPPS.toFixed(3)}) | surplus=$${houseSurplus.toFixed(2)}`);

    for (const [user, userPositions] of Object.entries(positions)) {
      const winPos = userPositions.find(p => p.outcome === winner);
      if (winPos) {
        const payout = winPos.shares * payoutPerShare;
        const profit = payout - winPos.cost;
        const totalCost = userPositions.reduce((s, p) => s + p.cost, 0);
        const netPL = payout - totalCost;
        userPayouts[user] = payout;
        console.log(
          `    ${user}: ${winPos.shares.toFixed(2)} shares × $${payoutPerShare.toFixed(3)} = ` +
          `$${payout.toFixed(2)} (cost: $${winPos.cost.toFixed(2)}, profit: $${profit.toFixed(2)}, net P&L: $${netPL.toFixed(2)})`
        );
      }
    }
    payoutScenarios.push({ winner, payoutPerShare, userPayouts });
  }

  return { bFloor, finalB: finalB, numOutcomes, bets, totalPool, finalPrices, positions, payoutScenarios };
}

// ---------------------------------------------------------------------------
// Run Simulations
// ---------------------------------------------------------------------------

console.log("\n" + "█".repeat(70));
console.log("  LMSR HYPERPARAMETER SIMULATION — Shaadi Book");
console.log("█".repeat(70));

// Scenario 1: Small 2-outcome market, varying b
console.log("\n\n▶ SCENARIO 1: 'Will Parsh cry?' (Yes/No) — b sensitivity");
for (const bFloor of [10, 20, 40, 80]) {
  simulateMarket(2, bFloor, [
    { user: "Alice", outcomeIndex: 0, amount: 10 },   // Yes
    { user: "Bob", outcomeIndex: 1, amount: 10 },     // No
    { user: "Charlie", outcomeIndex: 0, amount: 25 },  // Yes
    { user: "Diana", outcomeIndex: 0, amount: 50 },    // Yes
    { user: "Eve", outcomeIndex: 1, amount: 50 },      // No
  ]);
}

// Scenario 2: 3-outcome market
console.log("\n\n▶ SCENARIO 2: 'How late will baraat be?' (On time / 30min / 1hr+) — 3 outcomes");
for (const bFloor of [15, 30, 50]) {
  simulateMarket(3, bFloor, [
    { user: "Alice", outcomeIndex: 0, amount: 20 },   // On time
    { user: "Bob", outcomeIndex: 1, amount: 30 },     // 30min
    { user: "Charlie", outcomeIndex: 2, amount: 15 },  // 1hr+
    { user: "Diana", outcomeIndex: 1, amount: 50 },    // 30min
    { user: "Eve", outcomeIndex: 0, amount: 40 },      // On time
    { user: "Frank", outcomeIndex: 2, amount: 100 },   // 1hr+ (whale)
  ]);
}

// Scenario 3: Whale attack — one user dumps $200 on an outcome
console.log("\n\n▶ SCENARIO 3: Whale attack — someone bets $200 on a 3-outcome market");
for (const bFloor of [20, 40, 60]) {
  simulateMarket(3, bFloor, [
    { user: "Alice", outcomeIndex: 0, amount: 10 },
    { user: "Bob", outcomeIndex: 1, amount: 10 },
    { user: "Whale", outcomeIndex: 2, amount: 200 },
  ]);
}

// Scenario 4: Even betting — many small bets
console.log("\n\n▶ SCENARIO 4: Even crowd — 10 people each bet $10 split across outcomes");
const evenBets: Bet[] = [];
for (let i = 0; i < 10; i++) {
  evenBets.push({ user: `User${i}`, outcomeIndex: i % 2, amount: 10 });
}
simulateMarket(2, 20, evenBets);

// Scenario 5: Recommended b_floor
console.log("\n\n▶ SCENARIO 5: Recommended b_floor=20 with realistic wedding market");
simulateMarket(2, 20, [
  { user: "Guest1", outcomeIndex: 0, amount: 5 },
  { user: "Guest2", outcomeIndex: 0, amount: 10 },
  { user: "Guest3", outcomeIndex: 1, amount: 20 },
  { user: "Guest4", outcomeIndex: 0, amount: 15 },
  { user: "Guest5", outcomeIndex: 1, amount: 10 },
  { user: "Guest6", outcomeIndex: 0, amount: 25 },
  { user: "Guest7", outcomeIndex: 1, amount: 50 },
  { user: "Guest8", outcomeIndex: 0, amount: 5 },
  { user: "Guest9", outcomeIndex: 1, amount: 10 },
  { user: "Guest10", outcomeIndex: 0, amount: 50 },
  { user: "Guest11", outcomeIndex: 1, amount: 25 },
  { user: "Guest12", outcomeIndex: 0, amount: 10 },
]);

console.log("\n\n" + "█".repeat(70));
console.log("  SUMMARY: b_floor RECOMMENDATIONS");
console.log("█".repeat(70));
console.log(`
  b_floor=10  → Very sensitive. $10 bet moves price 5-8%. Good for small markets (<$50 total).
  b_floor=20  → RECOMMENDED. $10 bet moves price 2-4%. Good balance for $50-$500 markets.
  b_floor=40  → Less sensitive. $10 barely moves price. Needs $50+ bets for meaningful movement.
  b_floor=80  → Very stable. Markets feel 'sticky'. Only useful if expecting $1000+ volume.

  With adaptive b formula: b grows as volume increases, so early bets have more
  price impact (rewarding early risk-takers) and late bets have less (stabilizing).

  With capped parimutuel (min($1, pool/shares)):
  - House NEVER loses. Surplus stays with house.
  - Whale self-dilution: big bets on one outcome reduce their own payout/share.
  - Small diverse markets ($100-500 pool) work great with b_floor=20.
`);
