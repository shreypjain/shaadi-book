-- ---------------------------------------------------------------------------
-- fixed_supply_shares_selling
--
-- Migrates schema to support:
--   1. Fixed 100-shares-per-outcome cap (maxShares on outcomes, maxSharesPerOutcome on markets)
--   2. Fixed b parameter per market (bParameter on markets)
--   3. SALE transaction type — money flows from house_amm back to user on share sell
--
-- Uses the type-replacement pattern for the enum addition (compatible with
-- Prisma's transaction wrapper — ALTER TYPE … ADD VALUE cannot run inside a
-- transaction).
-- ---------------------------------------------------------------------------

-- AlterTable: add max_shares to outcomes
ALTER TABLE "outcomes" ADD COLUMN "max_shares" INTEGER NOT NULL DEFAULT 100;

-- AlterTable: add max_shares_per_outcome and b_parameter to markets
ALTER TABLE "markets"
  ADD COLUMN "max_shares_per_outcome" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "b_parameter" DECIMAL(10,4);

-- AlterEnum: add SALE to TransactionType
CREATE TYPE "TransactionType_new" AS ENUM (
  'DEPOSIT',
  'PURCHASE',
  'PAYOUT',
  'CHARITY_FEE',
  'WITHDRAWAL',
  'REFUND',
  'STRIPE_FEE',
  'SALE'
);

ALTER TABLE "transactions"
  ALTER COLUMN "type" TYPE "TransactionType_new"
  USING ("type"::text::"TransactionType_new");

DROP TYPE "TransactionType";

ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
