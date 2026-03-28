/**
 * Sequential market simulation — 10 users bet one at a time.
 * Shows the full price movement after each bet.
 */
import { test, expect } from "@playwright/test";

const BACKEND = "http://localhost:3001";
const JWT_SECRET = process.env.JWT_SECRET ?? "";

async function trpcMutate(request: any, proc: string, input: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await request.post(`${BACKEND}/trpc/${proc}`, { headers, data: input });
  return res.json();
}
async function trpcQuery(request: any, proc: string, input?: any, token?: string) {
  const url = input
    ? `${BACKEND}/trpc/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${BACKEND}/trpc/${proc}`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return (await request.get(url, { headers })).json();
}

const USERS = [
  "Priya Sharma", "Rahul Patel", "Ananya Gupta", "Vikram Singh", "Meera Reddy",
  "Arjun Nair", "Kavya Iyer", "Rohan Desai", "Neha Chopra", "Aditya Joshi",
];

// Pre-planned bets: [outcomeLabel, amountDollars]
const BETS: [string, number][] = [
  ["Yes", 20],   // Priya: big early Yes bet
  ["No", 15],    // Rahul: counter-bet on No
  ["Yes", 10],   // Ananya: follows Yes
  ["Yes", 25],   // Vikram: big Yes bet
  ["No", 8],     // Meera: small No
  ["No", 30],    // Arjun: large No counter
  ["Yes", 12],   // Kavya: moderate Yes
  ["No", 5],     // Rohan: tiny No
  ["Yes", 18],   // Neha: strong Yes
  ["No", 22],    // Aditya: late large No
];

test.describe.serial("Sequential 10-User Simulation", () => {
  const userTokens: { name: string; token: string; userId: string }[] = [];
  let adminToken = "";
  let marketId = "";
  let outcomes: { id: string; label: string }[] = [];

  test("Setup: Create users + fund them", async () => {
    const { execSync } = require("child_process");
    const jwt = require("jsonwebtoken");
    const crypto = require("crypto");

    // Get admin
    const adminId = execSync(
      `psql -t -A postgres://shreyjain@localhost:5432/shaadi_book -c "SELECT id FROM users WHERE phone = '+17327998071' LIMIT 1"`,
      { encoding: "utf-8" }
    ).trim();
    adminToken = jwt.sign({ userId: adminId, role: "ADMIN", phone: "+17327998071" }, JWT_SECRET, { expiresIn: "1h" });

    // Create 10 users + deposits with proper hash chain
    let prevHash = "0".repeat(64);
    for (let i = 0; i < USERS.length; i++) {
      const userId = `c0000000-0000-0000-0000-00000000000${i}`;
      const phone = `+1555100000${i}`;
      execSync(
        `psql -t -A postgres://shreyjain@localhost:5432/shaadi_book -c "INSERT INTO users (id, name, phone, country, role, created_at) VALUES ('${userId}', '${USERS[i]}', '${phone}', 'US', 'GUEST', NOW()) ON CONFLICT (phone) DO NOTHING"`,
        { encoding: "utf-8" }
      );

      // Deposit with proper hash chain
      const now = new Date().toISOString();
      const txHash = crypto.createHash("sha256").update(`${prevHash}|DEPOSIT|50.000000|${userId}|${now}`).digest("hex");
      execSync(
        `psql -t -A postgres://shreyjain@localhost:5432/shaadi_book -c "INSERT INTO transactions (id, user_id, debit_account, credit_account, type, amount, prev_hash, tx_hash, stripe_session_id, created_at) VALUES (gen_random_uuid(), '${userId}', 'stripe', 'user:${userId}', 'DEPOSIT', 50.000000, '${prevHash}', '${txHash}', 'seq_${i}', '${now}')"`,
        { encoding: "utf-8" }
      );
      prevHash = txHash;

      userTokens.push({
        name: USERS[i]!,
        token: jwt.sign({ userId, role: "GUEST", phone }, JWT_SECRET, { expiresIn: "1h" }),
        userId,
      });
    }
    console.log(`✓ Created ${USERS.length} users, each with $50`);
  });

  test("Create market", async ({ request }) => {
    const result = await trpcMutate(request, "market.create", {
      question: "Will Spoorthi's dad give a speech?",
      outcomeLabels: ["Yes", "No"],
    }, adminToken);

    marketId = result.result.data.id;
    outcomes = result.result.data.outcomes.map((o: any) => ({ id: o.id, label: o.label }));
    console.log(`✓ Market created: ${marketId}`);
  });

  test("10 users bet sequentially — track price movement", async ({ request }) => {
    console.log("\n  ┌─────────────────┬────────┬────────┬───────────┬───────────┬─────────┐");
    console.log("  │ User            │ Side   │ Amount │ Yes Price │ No Price  │ b value │");
    console.log("  ├─────────────────┼────────┼────────┼───────────┼───────────┼─────────┤");
    console.log("  │ (initial)       │        │        │   50.0¢   │   50.0¢   │  20.0   │");

    let successCount = 0;
    for (let i = 0; i < BETS.length; i++) {
      const user = userTokens[i]!;
      const [side, amount] = BETS[i]!;
      const outcome = outcomes.find(o => o.label === side)!;

      const result = await trpcMutate(request, "market.buy", {
        marketId,
        outcomeId: outcome.id,
        dollarAmountCents: amount * 100,
      }, user.token);

      if (result.result?.data) {
        successCount++;
        const d = result.result.data;
        const yesPrice = (d.allNewPrices?.[0] ?? d.priceAfterCents / 100) ;
        const noPrice = (d.allNewPrices?.[1] ?? 1 - yesPrice);
        const yesC = typeof yesPrice === 'number' && yesPrice < 1 ? (yesPrice * 100).toFixed(1) : String(yesPrice);
        const noC = typeof noPrice === 'number' && noPrice < 1 ? (noPrice * 100).toFixed(1) : String(noPrice);
        console.log(`  │ ${user.name.padEnd(15)} │ ${side.padEnd(6)} │ $${String(amount).padEnd(5)} │   ${String(yesC).padStart(5)}¢   │   ${String(noC).padStart(5)}¢   │ ${String(d.bAtPurchase?.toFixed?.(1) ?? '?').padStart(7)} │`);
      } else {
        const err = result.error?.message ?? "unknown";
        console.log(`  │ ${user.name.padEnd(15)} │ ${side.padEnd(6)} │ $${String(amount).padEnd(5)} │ ERROR: ${err.slice(0, 30).padEnd(30)} │`);
      }

      // Small delay to let the adaptive b factor in time
      await new Promise(r => setTimeout(r, 200));
    }

    console.log("  └─────────────────┴────────┴────────┴───────────┴───────────┴─────────┘");
    console.log(`\n  ${successCount}/10 bets succeeded`);
    expect(successCount).toBeGreaterThanOrEqual(8);
  });

  test("Show final positions", async ({ request }) => {
    console.log("\n  Positions after all bets:");
    for (const user of userTokens) {
      const result = await trpcQuery(request, "bets.myPositions", undefined, user.token);
      const positions = result.result?.data;
      if (Array.isArray(positions) && positions.length > 0) {
        for (const p of positions) {
          console.log(`    ${user.name}: ${p.shares?.toFixed?.(2) ?? p.shares} shares of ${p.outcomeLabel ?? p.outcome} @ avg $${(p.avgPriceCents / 100)?.toFixed?.(2) ?? '?'}`);
        }
      }
    }
  });

  test("Resolve market (Yes wins) and show payouts", async ({ request }) => {
    const yesOutcome = outcomes.find(o => o.label === "Yes")!;
    await trpcMutate(request, "market.resolve", {
      marketId,
      winningOutcomeId: yesOutcome.id,
    }, adminToken);

    console.log("\n  Post-resolution balances:");
    for (const user of userTokens) {
      const [betIdx] = [BETS[userTokens.indexOf(user)]!];
      const side = betIdx[0];
      const amount = betIdx[1];
      const result = await trpcQuery(request, "wallet.balance", undefined, user.token);
      const bal = result.result?.data;
      const balDollars = bal ? ((bal.balanceCents ?? bal.balance ?? 0) / 100).toFixed(2) : "?";
      const pnl = bal ? ((bal.balanceCents ?? bal.balance ?? 0) / 100 - 50).toFixed(2) : "?";
      const emoji = side === "Yes" ? "W" : "L";
      console.log(`    [${emoji}] ${user.name.padEnd(15)} bet $${amount} on ${side.padEnd(3)} → balance: $${balDollars} (P&L: ${pnl})`);
    }
  });

  test("Final charity pool + leaderboard", async ({ request }) => {
    const charity = await trpcQuery(request, "leaderboard.charityTotal");
    const lb = await trpcQuery(request, "leaderboard.list");

    console.log(`\n  Charity pool: $${((charity.result?.data?.totalCents ?? charity.result?.data?.total ?? 0) / 100).toFixed(2)}`);
    console.log("\n  Leaderboard:");
    const entries = lb.result?.data ?? [];
    for (const e of entries.slice(0, 10)) {
      console.log(`    #${e.rank} ${e.name}: P&L $${((e.realizedPnlCents ?? e.pnl ?? 0) / 100).toFixed(2)}`);
    }
  });
});
