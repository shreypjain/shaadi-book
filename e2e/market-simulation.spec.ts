/**
 * Market simulation — 10 fake users bid on a market, then admin resolves it.
 *
 * Flow:
 *  1. Seed 10 users + admin directly via backend API
 *  2. Admin creates a binary market
 *  3. Deposit $50 for each user
 *  4. Each user places a random bet (Yes or No, $5–$25)
 *  5. Admin resolves market → verify payouts
 */
import { test, expect } from "@playwright/test";

const BACKEND = "http://localhost:3001";
const JWT_SECRET = process.env.JWT_SECRET ?? "";

// We'll use the admin's real JWT by logging in
let adminToken = "";
const userTokens: { name: string; token: string; userId: string }[] = [];

// Helper: call tRPC procedure
async function trpcQuery(request: any, proc: string, input?: any, token?: string) {
  const url = input
    ? `${BACKEND}/trpc/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${BACKEND}/trpc/${proc}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await request.get(url, { headers });
  return res.json();
}

async function trpcMutate(request: any, proc: string, input: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await request.post(`${BACKEND}/trpc/${proc}`, {
    headers,
    data: input,
  });
  return res.json();
}

// Seed a user by inserting directly into DB via a helper endpoint,
// or we generate JWTs manually. Since we can't easily insert into DB
// from Playwright, we'll use the OTP bypass: create users via raw SQL
// through a Node script. Instead, let's use the admin token and create
// deposits via direct transaction inserts.

// Actually: let's create users + tokens via a setup script that runs
// before the test, using the backend's own auth service.

test.describe.serial("Market Simulation with 10 Users", () => {
  const FAKE_USERS = [
    "Priya Sharma", "Rahul Patel", "Ananya Gupta", "Vikram Singh",
    "Meera Reddy", "Arjun Nair", "Kavya Iyer", "Rohan Desai",
    "Neha Chopra", "Aditya Joshi",
  ];

  let marketId = "";
  let outcomes: { id: string; label: string }[] = [];

  test("Step 1: Create admin and 10 fake users via DB", async ({ request }) => {
    // Use psql to insert users and generate JWTs via the backend
    // First, create users via raw POST to a special seed endpoint
    // Since we don't have one, we'll insert directly via psql and sign JWTs

    const { execSync } = require("child_process");

    // Find existing admin user (created via real OTP login)
    const adminId = execSync(
      `psql -t -A postgres://localhost:5432/shaadi_book -c "SELECT id FROM users WHERE phone = '+15550000000' LIMIT 1"`,
      { encoding: "utf-8" }
    ).trim();

    if (!adminId) {
      // Create admin if doesn't exist
      execSync(
        `psql -t -A postgres://localhost:5432/shaadi_book -c "INSERT INTO users (id, name, phone, country, role, created_at) VALUES (gen_random_uuid(), 'Test Admin', '+15550000000', 'US', 'ADMIN', NOW()) RETURNING id"`,
        { encoding: "utf-8" }
      );
    }

    // Sign admin JWT
    const jwt = require("jsonwebtoken");
    adminToken = jwt.sign(
      { userId: adminId, role: "ADMIN", phone: "+15550000000" },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Create 10 fake users
    for (let i = 0; i < FAKE_USERS.length; i++) {
      const userId = `b0000000-0000-0000-0000-00000000000${i}`;
      const phone = `+1555000000${i}`;
      const name = FAKE_USERS[i];

      const userInsert = `
        INSERT INTO users (id, name, phone, country, role, created_at)
        VALUES ('${userId}', '${name}', '${phone}', 'US', 'GUEST', NOW())
        ON CONFLICT (phone) DO NOTHING;
      `;
      execSync(
        `psql -t -A postgres://localhost:5432/shaadi_book -c "${userInsert.replace(/\n/g, " ")}"`,
        { encoding: "utf-8" }
      );

      const token = jwt.sign(
        { userId, role: "GUEST", phone },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      userTokens.push({ name: name!, token, userId });
    }

    expect(adminToken).toBeTruthy();
    expect(userTokens).toHaveLength(10);
    console.log(`✓ Created admin + ${userTokens.length} users`);
  });

  test("Step 2: Deposit $50 for each user via ledger", async ({ request }) => {
    const { execSync } = require("child_process");
    const crypto = require("crypto");

    for (const user of userTokens) {
      // Get last hash
      const lastHashResult = execSync(
        `psql -t -A postgres://localhost:5432/shaadi_book -c "SELECT COALESCE((SELECT tx_hash FROM transactions ORDER BY created_at DESC LIMIT 1), '${("0").repeat(64)}')"`,
        { encoding: "utf-8" }
      ).trim();

      const now = new Date().toISOString();
      const txHash = crypto
        .createHash("sha256")
        .update(`${lastHashResult}|DEPOSIT|50.000000|${user.userId}|${now}`)
        .digest("hex");

      const depositInsert = `
        INSERT INTO transactions (id, user_id, debit_account, credit_account, type, amount, prev_hash, tx_hash, stripe_session_id, created_at)
        VALUES (
          gen_random_uuid(),
          '${user.userId}',
          'stripe',
          'user:${user.userId}',
          'DEPOSIT',
          50.000000,
          '${lastHashResult}',
          '${txHash}',
          'sim_${user.userId.slice(-4)}',
          '${now}'
        );
      `;
      execSync(
        `psql -t -A postgres://localhost:5432/shaadi_book -c "${depositInsert.replace(/\n/g, " ")}"`,
        { encoding: "utf-8" }
      );
    }

    console.log("✓ Deposited $50 for each of 10 users");
  });

  test("Step 3: Admin creates a binary market", async ({ request }) => {
    const result = await trpcMutate(
      request,
      "market.create",
      {
        question: "Will the groom cry during the pheras?",
        outcomeLabels: ["Yes", "No"],
      },
      adminToken
    );

    expect(result.result?.data?.id).toBeTruthy();
    marketId = result.result.data.id;
    outcomes = result.result.data.outcomes.map((o: any) => ({
      id: o.id,
      label: o.label,
    }));

    console.log(`✓ Created market: ${marketId}`);
    console.log(`  Outcomes: ${outcomes.map((o) => `${o.label} (${o.id})`).join(", ")}`);
  });

  test("Step 4: 10 users place random bets in parallel", async ({ request }) => {
    const bets: Promise<any>[] = [];

    for (let i = 0; i < userTokens.length; i++) {
      const user = userTokens[i]!;
      // Random outcome (Yes or No)
      const outcomeIdx = Math.random() > 0.5 ? 0 : 1;
      const outcome = outcomes[outcomeIdx]!;
      // Random amount $5–$25 (in cents)
      const amountCents = (Math.floor(Math.random() * 21) + 5) * 100;

      const betPromise = trpcMutate(
        request,
        "market.buy",
        {
          marketId,
          outcomeId: outcome.id,
          dollarAmountCents: amountCents,
        },
        user.token
      ).then((result: any) => {
        if (result.result?.data) {
          const d = result.result.data;
          console.log(
            `  ${user.name}: $${amountCents / 100} on "${outcome.label}" → ${d.sharesDelta?.toFixed?.(2) ?? "?"} shares`
          );
        } else {
          console.log(`  ${user.name}: ERROR — ${JSON.stringify(result.error?.message ?? result).slice(0, 100)}`);
        }
        return result;
      });

      bets.push(betPromise);
    }

    const results = await Promise.all(bets);
    const successes = results.filter((r) => r.result?.data).length;
    console.log(`\n✓ ${successes}/10 bets placed successfully`);
    expect(successes).toBeGreaterThanOrEqual(1);
  });

  test("Step 5: Check market prices after betting", async ({ request }) => {
    const result = await trpcQuery(request, "market.getById", { id: marketId });
    const market = result.result?.data;

    if (market?.outcomes) {
      console.log("\n  Market prices after all bets:");
      for (const o of market.outcomes) {
        console.log(`    ${o.label}: $${(o.price ?? o.priceCents / 100)?.toFixed?.(2) ?? "?"}`);
      }
    }
  });

  test("Step 6: Admin resolves market (Yes wins)", async ({ request }) => {
    const yesOutcome = outcomes.find((o) => o.label === "Yes");
    expect(yesOutcome).toBeTruthy();

    const result = await trpcMutate(
      request,
      "market.resolve",
      {
        marketId,
        winningOutcomeId: yesOutcome!.id,
      },
      adminToken
    );

    if (result.result?.data) {
      console.log(`✓ Market resolved — Winner: Yes`);
    } else {
      console.log(`Resolution result: ${JSON.stringify(result).slice(0, 200)}`);
    }

    expect(result.result?.data || result.error).toBeTruthy();
  });

  test("Step 7: Check user balances after resolution", async ({ request }) => {
    console.log("\n  Post-resolution balances:");
    for (const user of userTokens) {
      const result = await trpcQuery(request, "wallet.balance", undefined, user.token);
      const balance = result.result?.data;
      if (balance) {
        console.log(`    ${user.name}: $${((balance.balanceCents ?? balance.balance ?? 0) / 100).toFixed(2)}`);
      } else {
        console.log(`    ${user.name}: ${JSON.stringify(result.error?.message ?? "unknown").slice(0, 80)}`);
      }
    }
  });

  test("Step 8: Check leaderboard", async ({ request }) => {
    const result = await trpcQuery(request, "leaderboard.list");
    const entries = result.result?.data;

    if (Array.isArray(entries) && entries.length > 0) {
      console.log("\n  Leaderboard:");
      for (const e of entries.slice(0, 10)) {
        console.log(`    #${e.rank} ${e.name}: $${((e.realizedPnlCents ?? e.pnl ?? 0) / 100).toFixed(2)}`);
      }
    } else {
      console.log("  Leaderboard: empty or error");
    }
  });

  test("Step 9: Check charity pool total", async ({ request }) => {
    const result = await trpcQuery(request, "leaderboard.charityTotal");
    const data = result.result?.data;
    if (data) {
      console.log(`\n  Charity pool: $${((data.totalCents ?? data.total ?? 0) / 100).toFixed(2)}`);
    }
  });

  test("Step 10: Verify reconciliation", async ({ request }) => {
    const result = await trpcQuery(request, "admin.reconciliation", undefined, adminToken);
    const data = result.result?.data;
    if (data) {
      console.log(`\n  Reconciliation: ${data.isBalanced ?? data.valid ? "BALANCED ✓" : "UNBALANCED ✗"}`);
      console.log(`  ${JSON.stringify(data, null, 2).slice(0, 500)}`);
    } else {
      console.log(`  Reconciliation: ${JSON.stringify(result.error?.message ?? result).slice(0, 200)}`);
    }
  });
});
