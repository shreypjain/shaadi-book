/**
 * House Seeding Service
 *
 * Seeds new markets with an initial liquidity injection from the House account,
 * ensuring every outcome starts with a baseline probability and the LMSR AMM
 * has enough liquidity for price discovery.
 *
 * The House is represented as a real User row in the DB (phone = HOUSE_PHONE)
 * with ADMIN role. Its balance is funded via internal DEPOSIT transactions
 * (debit=house_seed, not Stripe) before each seeding operation.
 *
 * Architecture:
 *  1. getOrCreateHouseUser()  — upserts the House user row
 *  2. seedMarket()            — deposits totalDollars to house, then buyShares per outcome
 */

import { Decimal } from "decimal.js";
import { prisma } from "../db.js";
import { computeHash, getLastHash } from "./hashChain.js";
import { buyShares } from "./purchaseEngine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The House's phone number. Used to identify the House user in the DB. */
export const HOUSE_PHONE = "+17327998071";

/** Display name for the House user. */
export const HOUSE_NAME = "House";

/** Default seed per outcome in cents ($20.00 per outcome). */
export const DEFAULT_SEED_CENTS = 2000;

// ---------------------------------------------------------------------------
// getOrCreateHouseUser
// ---------------------------------------------------------------------------

/**
 * Upsert the House user row and return its UUID.
 * Safe to call concurrently — upsert is atomic.
 */
export async function getOrCreateHouseUser(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone: HOUSE_PHONE },
    update: {
      // Ensure name and role stay correct even if row already exists
      name: HOUSE_NAME,
      role: "ADMIN",
    },
    create: {
      phone: HOUSE_PHONE,
      name: HOUSE_NAME,
      country: "US",
      role: "ADMIN",
    },
    select: { id: true },
  });
  return user.id;
}

// ---------------------------------------------------------------------------
// seedMarket
// ---------------------------------------------------------------------------

/**
 * Seed a market with an initial liquidity injection from the House account.
 *
 * Steps:
 *  1. Get/create the House user.
 *  2. Open a Serializable transaction to deposit totalDollars to the house.
 *  3. For each outcome, call buyShares with bypassCap=true.
 *
 * The DEPOSIT uses debit='house_seed' (internal ledger source, not Stripe).
 * This keeps the double-entry invariant intact:
 *   credit user:house  → house balance rises by totalDollars
 *   then n × PURCHASE  → house balance decreases back to 0; house_amm grows
 *
 * @param marketId                  - UUID of the target market
 * @param outcomeIds                - Array of outcome UUIDs to seed (ordered)
 * @param seedAmountCentsPerOutcome - Cents to spend per outcome (e.g. 2000 = $20)
 */
export async function seedMarket(
  marketId: string,
  outcomeIds: string[],
  seedAmountCentsPerOutcome: number = DEFAULT_SEED_CENTS
): Promise<void> {
  if (outcomeIds.length === 0) return;
  if (seedAmountCentsPerOutcome <= 0) return;

  const houseUserId = await getOrCreateHouseUser();
  const totalDollars = (seedAmountCentsPerOutcome / 100) * outcomeIds.length;

  // -------------------------------------------------------------------------
  // 1. Deposit totalDollars to the House user so it has balance for buyShares
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.$transaction as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      const prevHash = await getLastHash(tx);
      const now = new Date();
      const txHash = computeHash(
        prevHash,
        "DEPOSIT",
        totalDollars.toFixed(6),
        houseUserId,
        now.toISOString()
      );

      await tx.transaction.create({
        data: {
          userId: houseUserId,
          debitAccount: "house_seed",
          creditAccount: `user:${houseUserId}`,
          type: "DEPOSIT",
          amount: new Decimal(totalDollars),
          prevHash,
          txHash,
          createdAt: now,
        },
      });
    },
    { isolationLevel: "Serializable", timeout: 10_000 }
  );

  // -------------------------------------------------------------------------
  // 2. Buy shares for each outcome — sequential to avoid market lock contention
  // -------------------------------------------------------------------------
  for (const outcomeId of outcomeIds) {
    await buyShares(houseUserId, marketId, outcomeId, seedAmountCentsPerOutcome, {
      bypassCap: true,
    });
  }
}
