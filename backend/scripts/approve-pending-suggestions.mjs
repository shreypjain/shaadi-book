#!/usr/bin/env node
/**
 * approve-pending-suggestions.mjs
 *
 * Approves all PENDING market suggestions and auto-creates + seeds markets.
 * Uses the same service functions as the API to ensure consistency.
 *
 * Run inside the production API container:
 *
 *   docker cp backend/scripts/approve-pending-suggestions.mjs shaadi-book-api-1:/tmp/
 *   docker exec -T shaadi-book-api-1 node /tmp/approve-pending-suggestions.mjs
 *
 * Or locally (with DATABASE_URL set):
 *   node backend/scripts/approve-pending-suggestions.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Find admin user
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    console.error("No admin user found.");
    process.exit(1);
  }
  console.log(`Admin: ${admin.name} (${admin.id})\n`);

  // Find all PENDING suggestions
  const pending = await prisma.marketSuggestion.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true } } },
  });

  if (pending.length === 0) {
    console.log("No pending suggestions. Nothing to do.");
    return;
  }

  console.log(`Found ${pending.length} pending suggestion(s):`);
  for (const s of pending) {
    console.log(`  - "${s.questionText}" [${s.outcomes.join(", ")}] (by ${s.user.name})`);
  }
  console.log();

  // Dynamically import the service modules (they use ESM imports internally)
  let createMarket, getMarketWithPrices, seedMarket, DEFAULT_SEED_CENTS;
  try {
    const ms = await import("../dist/services/marketService.js");
    createMarket = ms.createMarket;
    getMarketWithPrices = ms.getMarketWithPrices;
    const hs = await import("../dist/services/houseSeeding.js");
    seedMarket = hs.seedMarket;
    DEFAULT_SEED_CENTS = hs.DEFAULT_SEED_CENTS;
  } catch {
    console.log("Could not import compiled services. Falling back to direct DB operations.\n");
    createMarket = null;
  }

  let created = 0;

  for (const suggestion of pending) {
    const outcomes = suggestion.outcomes;

    try {
      if (createMarket) {
        // Use the real service layer
        const marketId = await createMarket(admin.id, suggestion.questionText, outcomes);
        const market = await getMarketWithPrices(marketId);

        if (market && seedMarket) {
          const outcomeIds = market.outcomes.map((o) => o.id);
          try {
            await seedMarket(marketId, outcomeIds, DEFAULT_SEED_CENTS);
            console.log(`  ✓ Created + seeded: "${suggestion.questionText}" (${marketId})`);
          } catch (seedErr) {
            console.log(`  ✓ Created (seed failed): "${suggestion.questionText}" (${marketId})`);
            console.error(`    Seed error: ${seedErr.message}`);
          }
        } else {
          console.log(`  ✓ Created: "${suggestion.questionText}" (${marketId})`);
        }
      } else {
        // Fallback: direct Prisma (no seeding)
        const market = await prisma.$transaction(async (tx) => {
          const m = await tx.market.create({
            data: {
              question: suggestion.questionText,
              status: "ACTIVE",
              createdById: admin.id,
              openedAt: new Date(),
              maxSharesPerOutcome: 1000,
              outcomes: {
                create: outcomes.map((label, i) => ({
                  label,
                  position: i,
                  sharesSold: 0,
                  maxShares: 1000,
                })),
              },
            },
          });

          await tx.adminAuditLog.create({
            data: {
              adminId: admin.id,
              action: "CREATE_MARKET",
              targetId: m.id,
              metadata: { question: m.question, outcomes },
              ipAddress: "script",
            },
          });

          return m;
        });
        console.log(`  ✓ Created (no seed): "${suggestion.questionText}" (${market.id})`);
      }

      // Mark suggestion as APPROVED
      await prisma.marketSuggestion.update({
        where: { id: suggestion.id },
        data: { status: "APPROVED", adminNotes: "Auto-approved via script" },
      });

      created++;
    } catch (err) {
      console.error(`  ✗ Failed: "${suggestion.questionText}" — ${err.message}`);
    }
  }

  console.log(`\nDone. Created ${created}/${pending.length} markets.`);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
