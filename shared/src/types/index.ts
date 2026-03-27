// ---------------------------------------------------------------------------
// Shaadi Book — Shared Types
// ---------------------------------------------------------------------------
// Placeholder types — full definitions added in Task 1.1 (DB schema) and
// Task 1.2 (LMSR engine). These are the canonical shapes shared between
// the frontend and backend.
// ---------------------------------------------------------------------------

export type UserRole = "guest" | "admin";

export type UserCountry = "US" | "IN";

export type MarketStatus = "pending" | "open" | "paused" | "resolved" | "voided";

export type TransactionType =
  | "deposit"
  | "purchase"
  | "withdrawal"
  | "payout"
  | "charity_fee"
  | "refund";

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------
export interface User {
  id: string;
  name: string;
  phone: string;
  country: UserCountry;
  role: UserRole;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------
export interface Market {
  id: string;
  question: string;
  status: MarketStatus;
  createdBy: string;
  openedAt: Date | null;
  scheduledOpenAt: Date | null;
  bFloorOverride: number | null;
  resolvedAt: Date | null;
  winningOutcomeId: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------
export interface Outcome {
  id: string;
  marketId: string;
  label: string;
  position: number;
  /** Total shares sold — the LMSR q[i] state vector */
  sharesSold: string; // Decimal serialized as string
  isWinner: boolean | null;
}

// ---------------------------------------------------------------------------
// Position (user holdings per outcome per market)
// ---------------------------------------------------------------------------
export interface Position {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  shares: string; // Decimal as string
  totalCost: string; // Decimal as string (cents)
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Purchase (immutable buy record)
// ---------------------------------------------------------------------------
export interface Purchase {
  id: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  shares: string;
  cost: string;
  avgPrice: string;
  priceBefore: string;
  priceAfter: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Transaction (double-entry ledger row)
// ---------------------------------------------------------------------------
export interface Transaction {
  id: string;
  userId: string;
  debitAccount: string;
  creditAccount: string;
  type: TransactionType;
  amount: string; // Decimal as string (cents)
  prevHash: string;
  txHash: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// LMSR Pricing
// ---------------------------------------------------------------------------
export interface PriceQuote {
  outcomeId: string;
  shares: string;
  cost: string;
  avgPrice: string;
  priceBefore: string;
  priceAfter: string;
  /** Prices for ALL outcomes after this purchase is applied */
  newPrices: Record<string, string>;
}

// ---------------------------------------------------------------------------
// WebSocket Events
// ---------------------------------------------------------------------------
export interface WsPriceUpdate {
  marketId: string;
  prices: Record<string, string>; // outcomeId -> price (0.00–1.00 as string)
  volume: string;
  b: string;
}

export interface WsPurchaseActivity {
  marketId: string;
  outcomeLabel: string;
  /** Price after purchase, for display */
  newPrice: string;
  timestamp: string;
}

export interface WsMarketFeedEvent {
  type: "created" | "opened" | "resolved" | "paused" | "voided" | "opening_soon";
  marketId: string;
  question?: string;
  /** For 'opening_soon': ms until open */
  opensInMs?: number;
}

export interface WsBalanceUpdate {
  userId: string;
  balanceCents: number;
}
