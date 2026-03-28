-- ---------------------------------------------------------------------------
-- Add STRIPE_FEE to TransactionType enum
--
-- Stripe processing fees (2.9% + $0.30 per deposit) are tracked as STRIPE_FEE
-- transactions so the admin dashboard can show:
--   gross_charity  = SUM(CHARITY_FEE)
--   stripe_fees    = SUM(STRIPE_FEE)
--   net_charity    = gross_charity - stripe_fees
--
-- Uses the type-replacement pattern (compatible with Prisma's transaction
-- wrapper — ALTER TYPE … ADD VALUE cannot run inside a transaction).
-- ---------------------------------------------------------------------------

-- AlterEnum: add STRIPE_FEE
CREATE TYPE "TransactionType_new" AS ENUM (
  'DEPOSIT',
  'PURCHASE',
  'PAYOUT',
  'CHARITY_FEE',
  'WITHDRAWAL',
  'REFUND',
  'STRIPE_FEE'
);

ALTER TABLE "transactions"
  ALTER COLUMN "type" TYPE "TransactionType_new"
  USING ("type"::text::"TransactionType_new");

DROP TYPE "TransactionType";

ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
