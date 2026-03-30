-- Raise default maxShares from 100 to 1000 for better LMSR pricing
-- b = 0.8 * maxShares / ln(19*(n-1)), so 1000 → b≈220 for 3 outcomes (was b≈22)

ALTER TABLE "markets" ALTER COLUMN "max_shares_per_outcome" SET DEFAULT 1000;
ALTER TABLE "outcomes" ALTER COLUMN "max_shares" SET DEFAULT 1000;

-- Update existing markets and outcomes
UPDATE "markets" SET "max_shares_per_outcome" = 1000 WHERE "max_shares_per_outcome" = 100;
UPDATE "outcomes" SET "max_shares" = 1000 WHERE "max_shares" = 100;
