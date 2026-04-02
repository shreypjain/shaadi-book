/**
 * House Seeding Service
 *
 * Seeds new markets with equal shares on all outcomes in a SINGLE atomic
 * transaction. This avoids the sequential-buy problem where buying outcome A
 * first moves the price, making outcome B cheaper and creating a lopsided market.
 *
 * Instead of going through the LMSR cost function sequentially, we:
 *  1. Compute the cost of buying `sharesPerOutcome` on ALL outcomes simultaneously
 *     using the LMSR cost function: cost = C(q + Δ) - C(q) where Δ is uniform.
 *  2. Insert all positions, purchases, and transactions in one DB transaction.
 *  3. Prices remain perfectly balanced after seeding (50/50 for 2 outcomes, 33/33/33 for 3).
 */

import { Decimal } from "decimal.js";
import { prisma } from "../db.js";
import { computeHash, getLastHash } from "./hashChain.js";
import { costFunction, defaultB } from "./lmsr.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HOUSE_PHONE = "+17327998071";
export const HOUSE_NAME = "House";
export const DEFAULT_SEED_CENTS = 2000;

// ---------------------------------------------------------------------------
// getOrCreateHouseUser
// ---------------------------------------------------------------------------

export async function getOrCreateHouseUser(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { phone: HOUSE_PHONE },
    update: { name: HOUSE_NAME, role: "ADMIN" },
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
// seedMarket — SINGLE BATCH, equal shares on all outcomes
// ---------------------------------------------------------------------------

/**
 * Seed a market by adding equal shares to every outcome in one atomic transaction.
 *
 * This keeps prices balanced (50/50 or 33/33/33) because adding the same Δ
 * to every q[i] doesn't change the LMSR price ratios.
 *
 * The cost is: C(q + [Δ,Δ,...,Δ]) - C(q) = Δ (for LMSR, adding equal shares
 * to all outcomes costs exactly Δ dollars regardless of b, since prices stay uniform).
 *
 * @param marketId - UUID of the target market
 * @param outcomeIds - Array of outcome UUIDs (ordered by position)
 * @param seedAmountCentsPerOutcome - Cents per outcome (e.g. 2000 = $20)
 */
export async function seedMarket(
  marketId: string,
  outcomeIds: string[],
  seedAmountCentsPerOutcome: number = DEFAULT_SEED_CENTS
): Promise<void> {
  if (outcomeIds.length === 0 || seedAmountCentsPerOutcome <= 0) return;

  const houseUserId = await getOrCreateHouseUser();
  const n = outcomeIds.length;
  const seedDollarsPerOutcome = seedAmountCentsPerOutcome / 100;

  // Fetch market to get current state
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { outcomes: { orderBy: { position: "asc" } } },
  });
  if (!market) throw new Error(`seedMarket: market ${marketId} not found`);

  const maxShares = market.maxSharesPerOutcome ?? 1000;
  const b = market.bParameter ? Number(market.bParameter) : defaultB(n, maxShares);

  // Current shares vector
  const q = market.outcomes.map((o) => Number(o.sharesSold));

  // Compute how many shares we can buy per outcome for the given dollar amount.
  // Adding equal shares Δ to all outcomes: cost = C(q+Δ) - C(q)
  // For uniform q, C(q+Δ) - C(q) = b * ln(n * e^((q0+Δ)/b)) - b * ln(n * e^(q0/b)) = Δ
  // So sharesPerOutcome ≈ seedDollarsPerOutcome (when starting from uniform q).
  // For safety, use binary search:
  const cBefore = costFunction(q, b);

  let lo = 0;
  let hi = seedDollarsPerOutcome * 10;
  const totalSeedDollars = seedDollarsPerOutcome * n;

  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const qNew = q.map((qi) => qi + mid);
    const cost = costFunction(qNew, b) - cBefore;
    if (Math.abs(cost - totalSeedDollars) < 1e-7) { lo = mid; hi = mid; break; }
    if (cost < totalSeedDollars) lo = mid; else hi = mid;
  }
  const sharesPerOutcome = (lo + hi) / 2;

  // Total cost of adding sharesPerOutcome to each outcome
  const qAfterSeed = q.map((qi) => qi + sharesPerOutcome);
  const actualCost = costFunction(qAfterSeed, b) - cBefore;
  const actualCostDecimal = new Decimal(actualCost).toDecimalPlaces(6, Decimal.ROUND_UP);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.$transaction as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any) => {
      // 1. Deposit the exact cost to house
      let prevHash = await getLastHash(tx);
      const now = new Date();
      const depositHash = computeHash(
        prevHash,
        "DEPOSIT",
        actualCostDecimal.toFixed(6),
        houseUserId,
        now.toISOString()
      );

      await tx.transaction.create({
        data: {
          userId: houseUserId,
          debitAccount: "house_seed",
          creditAccount: `user:${houseUserId}`,
          type: "DEPOSIT",
          amount: actualCostDecimal,
          prevHash,
          txHash: depositHash,
          createdAt: now,
        },
      });
      prevHash = depositHash;

      // 2. Single PURCHASE transaction for the total cost
      const purchaseAt = new Date();
      const purchaseHash = computeHash(
        prevHash,
        "PURCHASE",
        actualCostDecimal.toFixed(6),
        houseUserId,
        purchaseAt.toISOString()
      );

      await tx.transaction.create({
        data: {
          userId: houseUserId,
          debitAccount: `user:${houseUserId}`,
          creditAccount: "house_amm",
          type: "PURCHASE",
          amount: actualCostDecimal,
          prevHash,
          txHash: purchaseHash,
          createdAt: purchaseAt,
        },
      });
      prevHash = purchaseHash;

      // 3. Update all outcomes' sharesSold simultaneously
      const costPerOutcome = new Decimal(actualCost / n).toDecimalPlaces(6);
      for (let i = 0; i < outcomeIds.length; i++) {
        const outcomeId = outcomeIds[i]!;

        await tx.outcome.update({
          where: { id: outcomeId },
          data: { sharesSold: { increment: sharesPerOutcome } },
        });

        // Create purchase record
        await tx.purchase.create({
          data: {
            userId: houseUserId,
            marketId,
            outcomeId,
            shares: sharesPerOutcome,
            cost: costPerOutcome,
            avgPrice: costPerOutcome.div(sharesPerOutcome),
            bAtPurchase: new Decimal(b),
            priceBefore: new Decimal(1 / n),
            priceAfter: new Decimal(1 / n), // Same price — equal seeding
          },
        });

        // Upsert position
        const existingPos = await tx.position.findFirst({
          where: { userId: houseUserId, marketId, outcomeId },
        });
        if (existingPos) {
          await tx.position.update({
            where: { id: existingPos.id },
            data: {
              shares: { increment: sharesPerOutcome },
              totalCost: { increment: costPerOutcome },
            },
          });
        } else {
          await tx.position.create({
            data: {
              userId: houseUserId,
              marketId,
              outcomeId,
              shares: sharesPerOutcome,
              totalCost: costPerOutcome,
            },
          });
        }
      }
    },
    { isolationLevel: "Serializable", timeout: 15_000 }
  );

  console.log(
    `[houseSeeding] Seeded market ${marketId}: ${sharesPerOutcome.toFixed(2)} shares/outcome, ` +
    `$${actualCost.toFixed(2)} total cost, prices stay balanced`
  );
}
