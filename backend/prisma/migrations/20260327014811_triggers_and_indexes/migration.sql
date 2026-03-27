-- ---------------------------------------------------------------------------
-- Shaadi Book — Custom Migration: Immutable Ledger Triggers + Performance Indexes
-- Task 1.1: Database Schema + Migrations
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. INSERT-ONLY TRIGGERS
--    Prevent any UPDATE or DELETE on the append-only ledger tables.
--    transactions and purchases must never be modified after insertion —
--    this is the core integrity guarantee of the immutable ledger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Modifications to this table are not allowed';
END;
$$ LANGUAGE plpgsql;

-- Protect the transactions ledger
CREATE TRIGGER transactions_no_update
  BEFORE UPDATE OR DELETE ON "transactions"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_modify();

-- Protect the purchases ledger
CREATE TRIGGER purchases_no_update
  BEFORE UPDATE OR DELETE ON "purchases"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_modify();

-- ---------------------------------------------------------------------------
-- 2. PERFORMANCE INDEXES
--    Selected based on the query patterns in the LMSR purchase engine,
--    reconciliation function, and common API read paths.
-- ---------------------------------------------------------------------------

-- transactions(userId, type) — for balance derivation and filtering by type
CREATE INDEX idx_transactions_user_type
  ON "transactions" ("user_id", "type");

-- purchases(userId, marketId) — for $50 cap enforcement and user history
CREATE INDEX idx_purchases_user_market
  ON "purchases" ("user_id", "market_id");

-- positions(userId, marketId) — for user portfolio lookups during purchase engine
CREATE INDEX idx_positions_user_market
  ON "positions" ("user_id", "market_id");

-- outcomes(marketId) — critical for LMSR: lock all outcomes of a market in one scan
CREATE INDEX idx_outcomes_market
  ON "outcomes" ("market_id");

-- markets(status) — for market feed queries (active/pending markets)
CREATE INDEX idx_markets_status
  ON "markets" ("status");
