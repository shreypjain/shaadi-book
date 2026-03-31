/**
 * Typed API client for the Shaadi Book backend (tRPC HTTP protocol).
 *
 * We use @trpc/client's createTRPCProxyClient directly to call the backend.
 * Since the frontend and backend live in separate packages we define the
 * response types locally — they are kept in sync with the backend routers.
 *
 * tRPC HTTP protocol:
 *   Query   → GET  /api/trpc/<proc>?batch=1&input={"0":{"json":{...}}}
 *   Mutation → POST /api/trpc/<proc>  body: {"0":{"json":{...}}}
 */

import { createTRPCProxyClient, httpLink } from "@trpc/client";
import { getToken } from "./auth";

// ---------------------------------------------------------------------------
// Response types (mirroring backend router outputs)
// ---------------------------------------------------------------------------

export interface WalletBalance {
  balanceCents: number;
}

export interface TransactionItem {
  id: string;
  type: string;
  /** Positive = credit to user; negative = debit from user */
  amountCents: number;
  createdAt: string;
}

export interface DepositResult {
  clientSecret: string;
}

export interface PublishableKeyResult {
  publishableKey: string;
}

export interface WithdrawalRequestResult {
  id: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

export interface WithdrawalItem {
  id: string;
  amountCents: number;
  venmoHandle: string | null;
  zelleContact: string | null;
  status: string;
  createdAt: string;
  processedAt: string | null;
}

export interface PositionItem {
  id: string;
  marketId: string;
  marketQuestion: string;
  marketStatus: "pending" | "active" | "paused" | "resolved" | "voided";
  outcomeId: string;
  outcomeLabel: string;
  isWinner: boolean | null;
  shares: number;
  totalCostCents: number;
  avgPriceCents: number;
  currentPriceCents: number;
  currentValueCents: number;
  potentialPayoutCents: number;
  /** Total shares sold on this outcome — used to compute user's % of winnings pool. */
  outcomeSharesSold: number;
  /** ISO timestamp of the user's most recent purchase of this outcome (for 30-min sell cooldown). */
  lastPurchaseAt: string | null;
}

export interface SellResult {
  transactionId: string;
  /** Number of shares sold. */
  shares: number;
  /** Net revenue after fee — integer cents. */
  revenueCents: number;
  /** Gross revenue before fee — integer cents. */
  grossRevenueCents: number;
  /** Fee deducted — integer cents. */
  feeCents: number;
  priceBeforeCents: number;
  priceAfterCents: number;
  allNewPrices: number[];
  outcomeIds: string[];
  outcomeLabel: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  realizedPnlCents: number;
}

// ---------------------------------------------------------------------------
// tRPC proxy client (any-typed — we wrap in typed functions below)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _client = createTRPCProxyClient<any>({
  links: [
    httpLink({
      url: "/api/trpc",
      headers() {
        const token = getToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

// ---------------------------------------------------------------------------
// Typed API surface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth response types
// ---------------------------------------------------------------------------

export interface CheckPhoneResult {
  exists: boolean;
}

export interface SendOTPResult {
  status: "pending";
}

export interface VerifyOTPResult {
  token: string;
  user: {
    id: string;
    name: string;
    phone: string;
    country: string;
    role: "admin" | "guest";
  };
}

// ---------------------------------------------------------------------------
// Market Suggestion types
// ---------------------------------------------------------------------------

export interface MarketSuggestionItem {
  id: string;
  userId: string;
  questionText: string;
  outcomes: string[];
  description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  userName?: string;
  userPhone?: string;
}

export const api = {
  auth: {
    checkPhone: (input: {
      phone: string;
      country: "US" | "IN";
    }): Promise<CheckPhoneResult> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).auth.checkPhone.mutate(input) as Promise<CheckPhoneResult>,

    sendOTP: (input: {
      phone: string;
      country: "US" | "IN";
      name?: string;
    }): Promise<SendOTPResult> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).auth.sendOTP.mutate(input) as Promise<SendOTPResult>,

    verifyOTP: (input: {
      phone: string;
      country: "US" | "IN";
      code: string;
    }): Promise<VerifyOTPResult> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).auth.verifyOTP.mutate(input) as Promise<VerifyOTPResult>,
  },

  wallet: {
    balance: (): Promise<WalletBalance> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).wallet.balance.query() as Promise<WalletBalance>,

    transactions: (limit = 50): Promise<TransactionItem[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).wallet.transactions.query({ limit }) as Promise<TransactionItem[]>,

    createDeposit: (input: { amountCents: number }): Promise<DepositResult> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).payment.createDeposit.mutate(input) as Promise<DepositResult>,

    getPublishableKey: (): Promise<PublishableKeyResult> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).payment.getPublishableKey.query() as Promise<PublishableKeyResult>,

    requestWithdrawal: (input: {
      amountCents: number;
      venmoHandle?: string;
      zelleContact?: string;
    }): Promise<WithdrawalRequestResult> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).wallet.requestWithdrawal.mutate(input) as Promise<WithdrawalRequestResult>,

    withdrawals: (): Promise<WithdrawalItem[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).wallet.withdrawals.query() as Promise<WithdrawalItem[]>,
  },

  market: {
    list: (input: { status?: string; eventTag?: string; familySide?: string }): Promise<any[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.list.query(input) as Promise<any[]>,

    getById: (input: { id: string }): Promise<any> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.getById.query(input) as Promise<any>,

    buy: (input: { marketId: string; outcomeId: string; dollarAmountCents: number }): Promise<any> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.buy.mutate(input) as Promise<any>,

    sell: (input: { marketId: string; outcomeId: string; shares: number }): Promise<SellResult> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.sell.mutate(input) as Promise<SellResult>,

    priceHistory: (input: {
      marketId: string;
      hours?: number;
    }): Promise<Record<string, Array<{ priceCents: number; time: string }>>> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.priceHistory.query(input) as Promise<
        Record<string, Array<{ priceCents: number; time: string }>>
      >,

    watch: (input: { marketId: string }): Promise<{ watching: boolean }> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.watch.mutate(input) as Promise<{ watching: boolean }>,

    unwatch: (input: { marketId: string }): Promise<{ watching: boolean }> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.unwatch.mutate(input) as Promise<{ watching: boolean }>,

    isWatching: (input: { marketId: string }): Promise<{ watching: boolean }> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.isWatching.query(input) as Promise<{ watching: boolean }>,

    myWatchlist: (): Promise<string[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.myWatchlist.query() as Promise<string[]>,

    tradeHistory: (input: {
      marketId: string;
      cursor?: string;
      limit?: number;
    }): Promise<{
      trades: Array<{
        id: string;
        outcomeId: string;
        outcomeLabel: string;
        userName: string | null;
        shares: number;
        cost: number;
        avgPrice: number;
        priceBefore: number;
        priceAfter: number;
        createdAt: string;
      }>;
      nextCursor?: string;
    }> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.tradeHistory.query(input) as Promise<any>,

    voidTradesAfter: (input: {
      marketId: string;
      cutoffTime: string;
    }): Promise<{ voidedCount: number; totalRefunded: number }> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.voidTradesAfter.mutate(input) as Promise<{
        voidedCount: number;
        totalRefunded: number;
      }>,

    positions: (input: {
      marketId: string;
    }): Promise<{
      positions: Array<{
        userId: string;
        userName: string | null;
        dominantOutcomeId: string;
        dominantOutcomeLabel: string;
        netSharesByOutcome: Record<string, { shares: number; label: string }>;
        totalDeployed: number;
        costBasis: number;
        tradeCount: number;
      }>;
      totalVolume: number;
    }> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).market.positions.query(input) as Promise<any>,
  },

  bets: {
    myPositions: (): Promise<PositionItem[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).bets.myPositions.query() as Promise<PositionItem[]>,
  },

  leaderboard: {
    list: (): Promise<LeaderboardEntry[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).leaderboard.list.query() as Promise<LeaderboardEntry[]>,

  },

  suggest: {
    submit: (input: {
      questionText: string;
      outcomes: string[];
      description?: string;
    }): Promise<MarketSuggestionItem> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).suggest.submit.mutate(input) as Promise<MarketSuggestionItem>,

    myList: (): Promise<MarketSuggestionItem[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).suggest.myList.query() as Promise<MarketSuggestionItem[]>,

    adminList: (input?: { status?: "PENDING" | "APPROVED" | "REJECTED" }): Promise<MarketSuggestionItem[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).suggest.adminList.query(input ?? {}) as Promise<MarketSuggestionItem[]>,

    adminReview: (input: {
      suggestionId: string;
      status: "APPROVED" | "REJECTED";
      adminNotes?: string;
    }): Promise<MarketSuggestionItem> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).suggest.adminReview.mutate(input) as Promise<MarketSuggestionItem>,
  },
};

// ---------------------------------------------------------------------------
// Formatting helpers (used across multiple components)
// ---------------------------------------------------------------------------

/**
 * Fixed exchange rate used at the Stripe payment boundary for INR deposits.
 * Must match the backend constant in backend/src/services/stripe.ts.
 * When an Indian user deposits ₹850 via UPI, the ledger records $10 (1000 cents).
 */
export const INR_PER_USD = 85;

/** Format cents as "$X.XX" */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Format cents as "₹X" (approximate INR for display only) */
export function formatRupees(cents: number): string {
  const dollars = cents / 100;
  const rupees = Math.round(dollars * 93);
  return `≈ ₹${rupees.toLocaleString("en-IN")}`;
}

/**
 * Convert a USD cents amount to the INR rupee display string for deposits.
 * Uses INR_PER_USD (85) — the same rate applied at the Stripe payment boundary.
 * e.g. usdCentsToInrDisplay(1000) → "₹850"
 */
export function usdCentsToInrDisplay(usdCents: number): string {
  const rupees = Math.round((usdCents / 100) * INR_PER_USD);
  return `₹${rupees.toLocaleString("en-IN")}`;
}
