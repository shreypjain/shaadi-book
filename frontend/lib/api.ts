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
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  realizedPnlCents: number;
}

export interface CharityTotal {
  totalCents: number;
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

export const api = {
  auth: {
    sendOTP: (input: {
      phone: string;
      country: "US" | "IN";
      name: string;
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

  bets: {
    myPositions: (): Promise<PositionItem[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).bets.myPositions.query() as Promise<PositionItem[]>,
  },

  leaderboard: {
    list: (): Promise<LeaderboardEntry[]> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).leaderboard.list.query() as Promise<LeaderboardEntry[]>,

    charityTotal: (): Promise<CharityTotal> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (_client as any).leaderboard.charityTotal.query() as Promise<CharityTotal>,
  },
};

// ---------------------------------------------------------------------------
// Formatting helpers (used across multiple components)
// ---------------------------------------------------------------------------

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
