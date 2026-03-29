-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "outcome_id" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_snapshots_market_id_created_at_idx" ON "price_snapshots"("market_id", "created_at");

-- CreateIndex
CREATE INDEX "price_snapshots_outcome_id_created_at_idx" ON "price_snapshots"("outcome_id", "created_at");

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
