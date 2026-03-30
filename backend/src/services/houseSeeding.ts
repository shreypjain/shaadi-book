/**
 * House Seeding Service
 *
 * Provides initial liquidity for every market by placing equal bets on all
 * outcomes from an internal "House" account.
 *
 * Workflow (called after a market opens):
 *   1. getOrCreateHouseUser() — upsert the house user (phone +0000000000).
 *   2. Mint credits for the house via a direct DEPOSIT ledger entry
 *      (debitAccount = "house_seed", creditAccount = "user:{houseId}").
 *      This is internal bookkeeping — no Stripe payment.
 *   3. For each outcome, call buyShares() with bypassCap=true so the $200
 *      per-user-per-market cap is skipped.
 *
 * Accounting invariant (always holds after seeding):
 *   DEPOSIT minted = seedPerOutcome * numOutcomes
 *   PURCHASE debits = seedPerOutcome * numOutcomes
 *   house user balance after seeding = 0 ✓
 *   house_amm balance += seedPerOutcome * numOutcomes ✓
 *   SUM(user balances) + house_amm + withdrawals = deposits ✓
 */

import { Decimal } from "decimal.js";
import { prisma } from "../db.js";
import { computeHash, getLastHash } from "./hashChain.js";
import { buyShares } from "./purchaseEngine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HOUSE_PHONE = "+0000000000";
export const HOUSE_NAME = "House";
export const DEFAULT_SEED_CENTS = 2000; // $20 per outcome

// ---------------------------------------------------------------------------
// getOrCreateHouseUser
// ---------------------------------------------------------------------------

/**
 * Find or create the internal house liquidity user.
 * Returns the house user's UUID.
 */
export async function getOrCreateHouseUser(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { phone: HOUSE_PHONE },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: {
      name: HOUSE_NAME,
      phone: HOUSE_PHONE,
      country: "US",
      role: "ADMIN",
      isHouse: true,
    },
    select: { id: true },
  });
  return created.id;
}

// ---------------------------------------------------------------------------
// seedMarket
// ---------------------------------------------------------------------------

/**
 * Seed a newly-opened market with equal bets on every outcome from the house.
 *
 * @param marketId                - UUID of the (ACTIVE) market to seed
 * @param outcomeIds              - ordered array of outcome UUIDs (must match market)
 * @param seedAmountCentsPerOutcome - amount in cents to bet per outcome (e.g. 2000 = $20)
 *
 * Skips seeding if seedAmountCentsPerOutcome <= 0 or outcomeIds is empty.
 */
export async function seedMarket(
  marketId: string,
  outcomeIds: string[],
  seedAmountCentsPerOutcome: number
): Promise<void> {
  if (seedAmountCentsPerOutcome <= 0 || outcomeIds.length === 0) return;

  const houseUserId = await getOrCreateHouseUser();
  const seedPerOutcome = seedAmountCentsPerOutcome / 100; // convert to dollars
  const totalDollars = seedPerOutcome * outcomeIds.length;

  // -------------------------------------------------------------------------
  // Mint credits for the house via a direct DEPOSIT ledger entry.
  // debitAccount = "house_seed" — a synthetic external source (not Stripe).
  // creditAccount = "user:{houseId}" — the house's ledger balance.
  // -------------------------------------------------------------------------
  const prevHash = await getLastHash();
  const depositAt = new Date();
  const depositHash = computeHash(
    prevHash,
    "DEPOSIT",
    totalDollars.toFixed(6),
    houseUserId,
    depositAt.toISOString()
  );

  await prisma.transaction.create({
    data: {
      userId: houseUserId,
      debitAccount: "house_seed",
      creditAccount: `user:${houseUserId}`,
      type: "DEPOSIT",
      amount: new Decimal(totalDollars),
      prevHash,
      txHash: depositHash,
      createdAt: depositAt,
    },
  });

  // -------------------------------------------------------------------------
  // Purchase shares for each outcome sequentially.
  // bypassCap=true skips the $200 per-user-per-market cap for the house.
  // -------------------------------------------------------------------------
  for (const outcomeId of outcomeIds) {
    await buyShares(houseUserId, marketId, outcomeId, seedAmountCentsPerOutcome, {
      bypassCap: true,
    });
  }
}
