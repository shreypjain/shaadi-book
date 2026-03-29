/**
 * Wallet tRPC Router — Task 4.2
 *
 * Endpoints (all protected — require valid JWT):
 *   wallet.balance          — current balance derived from ledger
 *   wallet.transactions     — paginated transaction history
 *   wallet.createDeposit    — create Stripe Checkout session
 *   wallet.requestWithdrawal — submit Venmo/Zelle withdrawal request
 *   wallet.withdrawals      — list user's withdrawal requests
 *
 * References:
 *   PRD §7.2 — Deposit flow
 *   PRD §7.3 — Withdrawal flow
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import Stripe from "stripe";
import { router, protectedProcedure } from "../trpc.js";
import { prisma } from "../db.js";
import { getUserBalance } from "../services/balance.js";
import { toNumber } from "../utils/coerce.js";

// ---------------------------------------------------------------------------
// Stripe client (lazy — fails gracefully if key not configured)
// ---------------------------------------------------------------------------

function getStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Payment processing is not configured.",
    });
  }
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const walletRouter = router({
  /**
   * wallet.balance
   * Returns the user's current balance derived from the ledger.
   */
  balance: protectedProcedure.query(async ({ ctx }) => {
    const balanceCents = await getUserBalance(ctx.userId);
    return { balanceCents };
  }),

  /**
   * wallet.transactions
   * Returns paginated transaction history for the authenticated user.
   * Each row is labelled with a human-readable sign (positive = credit, negative = debit).
   */
  transactions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const txs = await prisma.transaction.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          type: true,
          amount: true,
          debitAccount: true,
          creditAccount: true,
          createdAt: true,
        },
      });

      const userAccount = `user:${ctx.userId}`;
      return txs.map((tx: {
        id: string;
        type: string;
        amount: unknown;
        debitAccount: string;
        creditAccount: string;
        createdAt: Date;
      }) => {
        const isCredit = tx.creditAccount === userAccount;
        const amountCents = Math.round(Number(tx.amount) * 100);
        return {
          id: tx.id,
          type: tx.type,
          // Positive → money flowing in; negative → money flowing out
          amountCents: isCredit ? amountCents : -amountCents,
          createdAt: tx.createdAt.toISOString(),
        };
      });
    }),

  /**
   * wallet.createDeposit
   * Creates a Stripe Checkout session and returns the redirect URL.
   * The webhook handler (Task 3.x) credits the balance on payment_intent.succeeded.
   */
  createDeposit: protectedProcedure
    .input(
      z.object({
        // $5 minimum, $500 maximum (in cents)
        amountCents: z.number().int().min(500).max(50000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const frontendUrl =
        process.env["FRONTEND_URL"] ?? "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: input.amountCents,
              product_data: {
                name: "Shaadi Book Credits",
                description: `$${(input.amountCents / 100).toFixed(2)} of prediction market credits`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${frontendUrl}/wallet?deposit=success`,
        cancel_url: `${frontendUrl}/wallet?deposit=cancelled`,
        metadata: {
          userId: ctx.userId,
          amountCents: String(input.amountCents),
        },
      });

      if (!session.url) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create Stripe checkout session.",
        });
      }

      return { checkoutUrl: session.url };
    }),

  /**
   * wallet.requestWithdrawal
   * Submits a withdrawal request. Shrey processes manually post-event.
   * Validates the requested amount does not exceed the current balance.
   */
  requestWithdrawal: protectedProcedure
    .input(
      z
        .object({
          // $1 minimum (in cents)
          amountCents: z.number().int().min(100),
          venmoHandle: z.string().min(1).max(100).optional(),
          zelleContact: z.string().min(1).max(200).optional(),
        })
        .refine((d) => d.venmoHandle || d.zelleContact, {
          message: "Provide either a Venmo handle or a Zelle email/phone.",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const balanceCents = await getUserBalance(ctx.userId);

      if (input.amountCents > balanceCents) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Withdrawal amount $${(input.amountCents / 100).toFixed(2)} exceeds available balance $${(balanceCents / 100).toFixed(2)}.`,
        });
      }

      const amountDollars = input.amountCents / 100;

      const request = await prisma.withdrawalRequest.create({
        data: {
          userId: ctx.userId,
          amount: amountDollars,
          venmoHandle: input.venmoHandle ?? null,
          zelleContact: input.zelleContact ?? null,
          status: "PENDING",
        },
      });

      return {
        id: request.id,
        amountCents: Math.round(Number(request.amount) * 100),
        status: request.status as string,
        createdAt: request.createdAt.toISOString(),
      };
    }),

  /**
   * wallet.charityInfo
   *
   * Computes the user's lifetime profit and outstanding charity obligation.
   *
   * Charity model: 20% of lifetime profit is owed to charity and withheld at
   * withdrawal time (NOT at market resolution).  Users see a real-time
   * breakdown so they know how much is freely withdrawable.
   *
   * Formula:
   *   profitDollars = balance + pastWithdrawals + pastCharityPaid − totalDeposits
   *   charityOwed   = max(0, profit × 0.20)
   *   charityRemaining = max(0, charityOwed − charityPaid)
   *   netWithdrawable  = max(0, balance − charityRemaining)
   */
  charityInfo: protectedProcedure.query(async ({ ctx }) => {
    const userAccount = `user:${ctx.userId}`;

    const rows = await prisma.$queryRaw<
      Array<{
        balance: unknown;
        past_withdrawals: unknown;
        past_charity_paid: unknown;
        total_deposits: unknown;
      }>
    >`
      SELECT
        COALESCE(
          SUM(CASE WHEN credit_account = ${userAccount} THEN amount ELSE 0 END)
          - SUM(CASE WHEN debit_account  = ${userAccount} THEN amount ELSE 0 END),
          0
        ) AS balance,
        COALESCE(
          SUM(CASE WHEN type = 'WITHDRAWAL' AND debit_account = ${userAccount} THEN amount ELSE 0 END),
          0
        ) AS past_withdrawals,
        COALESCE(
          SUM(CASE WHEN type = 'CHARITY_FEE' AND debit_account = ${userAccount} THEN amount ELSE 0 END),
          0
        ) AS past_charity_paid,
        COALESCE(
          SUM(CASE WHEN type = 'DEPOSIT' AND credit_account = ${userAccount} THEN amount ELSE 0 END),
          0
        ) AS total_deposits
      FROM transactions
    `;

    const row = rows[0];
    if (!row) {
      return {
        profitCents: 0,
        charityOwedCents: 0,
        charityPaidCents: 0,
        charityRemainingCents: 0,
        netWithdrawableCents: 0,
      };
    }

    const balanceDollars = toNumber(row.balance);
    const pastWithdrawalsDollars = toNumber(row.past_withdrawals);
    const pastCharityPaidDollars = toNumber(row.past_charity_paid);
    const totalDepositsDollars = toNumber(row.total_deposits);

    // Lifetime profit = how much the user gained from the system beyond their deposits.
    // Equivalent to: totalPayouts - totalPurchases
    const profitDollars =
      balanceDollars +
      pastWithdrawalsDollars +
      pastCharityPaidDollars -
      totalDepositsDollars;

    const charityOwedDollars = Math.max(0, profitDollars * 0.2);
    const charityPaidDollars = pastCharityPaidDollars;
    const charityRemainingDollars = Math.max(
      0,
      charityOwedDollars - charityPaidDollars
    );
    const netWithdrawableDollars = Math.max(
      0,
      balanceDollars - charityRemainingDollars
    );

    return {
      profitCents: Math.round(profitDollars * 100),
      charityOwedCents: Math.round(charityOwedDollars * 100),
      charityPaidCents: Math.round(charityPaidDollars * 100),
      charityRemainingCents: Math.round(charityRemainingDollars * 100),
      netWithdrawableCents: Math.round(netWithdrawableDollars * 100),
    };
  }),

  /**
   * wallet.withdrawals
   * Lists all withdrawal requests submitted by the authenticated user.
   */
  withdrawals: protectedProcedure.query(async ({ ctx }) => {
    const requests = await prisma.withdrawalRequest.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
    });

    return requests.map((r: {
      id: string;
      amount: unknown;
      venmoHandle: string | null;
      zelleContact: string | null;
      status: string;
      createdAt: Date;
      processedAt: Date | null;
    }) => ({
      id: r.id,
      amountCents: Math.round(Number(r.amount) * 100),
      venmoHandle: r.venmoHandle,
      zelleContact: r.zelleContact,
      status: r.status as string,
      createdAt: r.createdAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
    }));
  }),
});
