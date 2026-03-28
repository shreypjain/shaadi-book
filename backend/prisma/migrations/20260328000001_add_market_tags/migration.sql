-- AlterTable
ALTER TABLE "markets" ADD COLUMN "event_tag" TEXT,
ADD COLUMN "family_side" TEXT,
ADD COLUMN "custom_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
