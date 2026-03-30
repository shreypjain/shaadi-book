/**
 * House Seeding Service
 *
 * Auto-seeds each new market with $20/outcome from a virtual House account.
 * The House account is a regular user row (phone="+0000000000") so it flows
 * through the normal purchase engine and ledger — no special DB columns needed.
 *
 * Accounting:
 *   DEPOSIT  — debit house_seed (external source), credit user:{houseId}
 *   PURCHASE — debit user:{houseId}, credit house_amm  (one per outcome)
 *
 * Reconciliation holds because total_deposits += seed amount, and
 * user_balances nets to zero after the purchases consume the deposited funds.
 */

import { prisma } from "../db.js";
import { buyShares } from "./purchaseEngine.js";
import { computeHash } from "./hashChain.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HOUSE_PHONE = "+0000000000";
const HOUSE_NAME = "House";
export const DEFAULT_SEED_CENTS = 2000; // $20

// ---------------------------------------------------------------------------
// Module-level cache — avoids a DB round-trip on every seed call
// ---------------------------------------------------------------------------

let _houseUserId: string | null = null;

// ---------------------------------------------------------------------------
// getOrCreateHouseUser
// ---------------------------------------------------------------------------

/**
 * Find or create the virtual House user.
 * The result is cached in-process so subsequent calls are O(1).
 */
export async function getOrCreateHouseUser(): Promise<{ id: string }> {
  if (_houseUserId) return { id: _houseUserId };

  const existing = await prisma.user.findUnique({
    where: { phone: HOUSE_PHONE },
    select: { id: true },
  });

  if (existing) {
    _houseUserId = existing.id;
    return existing;
  }

  const created = await prisma.user.create({
    data: {
      name: HOUSE_NAME,
      phone: HOUSE_PHONE,
      country: "US",
      role: "GUEST",
    },
    select: { id: true },
  });

  _houseUserId = created.id;
  return created;
}

// ---------------------------------------------------------------------------
// seedMarket
// ---------------------------------------------------------------------------

/**
 * Seed a market by buying `seedAmountCentsPerOutcome` cents of each outcome
 * from the House account.
 *
 * Steps:
 *  1. Get/create house user.
 *  2. Fetch market outcomes.
 *  3. Mint credits: INSERT DEPOSIT (debit house_seed, credit user:{houseId}).
 *  4. For each outcome: call buyShares with skipCapCheck=true.
 *
 * @param marketId                  UUID of the newly created market
 * @param seedAmountCentsPerOutcome Seed amount per outcome in cents (default $20 = 2000)
 */
export async function seedMarket(
  marketId: string,
  seedAmountCentsPerOutcome: number = DEFAULT_SEED_CENTS
): Promise<void> {
  // 1. Get/create house user
  const houseUser = await getOrCreateHouseUser();

  // 2. Fetch market outcomes
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { outcomes: { orderBy: { position: "asc" } } },
  });
  if (!market) throw new Error(`seedMarket: Market ${marketId} not found`);

  const numOutcomes = market.outcomes.length;
  const totalDepositDollars = (numOutcomes * seedAmountCentsPerOutcome) / 100;

  // 3. Mint credits via a single DEPOSIT transaction
  //    debitAccount  = "house_seed"  — external source (not tracked in reconciliation LHS)
  //    creditAccount = "user:{houseId}" — gives house user the budget to bet
  const lastTx = await prisma.transaction.findFirst({
    orderBy: { createdAt: "desc" },
    select: { txHash: true },
  });
  const prevHash = lastTx?.txHash ?? "0".repeat(64);
  const now = new Date();
  const txHash = computeHash(
    prevHash,
    "DEPOSIT",
    totalDepositDollars.toFixed(6),
    houseUser.id,
    now.toISOString()
  );

  await prisma.transaction.create({
    data: {
      userId: houseUser.id,
      debitAccount: "house_seed",
      creditAccount: `user:${houseUser.id}`,
      type: "DEPOSIT",
      amount: totalDepositDollars,
      prevHash,
      txHash,
      createdAt: now,
    },
  });

  // 4. Buy shares for each outcome.
  //    The house user's phone (+0000000000) is checked in purchaseEngine.ts
  //    to bypass the $200/market cap automatically.
  for (const outcome of market.outcomes) {
    await buyShares(houseUser.id, marketId, outcome.id, seedAmountCentsPerOutcome);
  }
}
