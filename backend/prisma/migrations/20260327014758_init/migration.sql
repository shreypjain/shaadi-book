-- CreateEnum
CREATE TYPE "Country" AS ENUM ('US', 'IN');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('GUEST', 'ADMIN');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'RESOLVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'PURCHASE', 'PAYOUT', 'CHARITY_FEE', 'WITHDRAWAL', 'REFUND');

-- CreateEnum
CREATE TYPE "AdminAction" AS ENUM ('CREATE_MARKET', 'RESOLVE_MARKET', 'PAUSE_MARKET', 'VOID_MARKET', 'APPROVE_WITHDRAWAL', 'REJECT_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'GUEST',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3),
    "scheduled_open_at" TIMESTAMP(3),
    "b_floor_override" DECIMAL(18,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "winning_outcome_id" TEXT,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcomes" (
    "id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "shares_sold" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "is_winner" BOOLEAN,

    CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "outcome_id" TEXT NOT NULL,
    "shares" DECIMAL(18,6) NOT NULL,
    "total_cost" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "outcome_id" TEXT NOT NULL,
    "shares" DECIMAL(18,6) NOT NULL,
    "cost" DECIMAL(18,6) NOT NULL,
    "avg_price" DECIMAL(18,6) NOT NULL,
    "price_before" DECIMAL(18,6) NOT NULL,
    "price_after" DECIMAL(18,6) NOT NULL,
    "b_at_purchase" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "debit_account" TEXT NOT NULL,
    "credit_account" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "prev_hash" CHAR(64) NOT NULL,
    "tx_hash" CHAR(64) NOT NULL,
    "stripe_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" "AdminAction" NOT NULL,
    "target_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL,
    "ip_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "venmo_handle" TEXT,
    "zelle_contact" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "admin_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "positions_user_id_market_id_outcome_id_key" ON "positions"("user_id", "market_id", "outcome_id");

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_winning_outcome_id_fkey" FOREIGN KEY ("winning_outcome_id") REFERENCES "outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
