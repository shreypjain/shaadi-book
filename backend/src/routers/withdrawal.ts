/**
 * Withdrawal tRPC Router — Task 3.2
 *
 * Endpoints:
 *   withdrawal.request     — authenticated guest: submit withdrawal request
 *   withdrawal.myHistory   — authenticated guest: own withdrawal history
 *   withdrawal.listPending — admin only: queue of PENDING requests
 *   withdrawal.approve     — admin only: approve + debit ledger
 *   withdrawal.complete    — admin only: mark as sent
 *   withdrawal.reject      — admin only: reject without balance change
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc.js";
import {
  requestWithdrawal,
  approveWithdrawal,
  completeWithdrawal,
  rejectWithdrawal,
  listPendingWithdrawals,
  getUserWithdrawals,
  WithdrawalError,
} from "../services/withdrawalService.js";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const withdrawalRouter = router({
  /**
   * withdrawal.request — authenticated
   * Guest submits a withdrawal request with Venmo or Zelle contact info.
   */
  request: protectedProcedure
    .input(
      z.object({
        amountCents: z.number().int().positive(),
        venmoHandle: z.string().min(1).optional(),
        zelleContact: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await requestWithdrawal(
          ctx.userId,
          input.amountCents,
          input.venmoHandle,
          input.zelleContact
        );
      } catch (err) {
        if (err instanceof WithdrawalError) {
          switch (err.code) {
            case "INVALID_AMOUNT":
            case "NO_CONTACT_METHOD":
            case "INSUFFICIENT_BALANCE":
              throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
            default:
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: err.message,
              });
          }
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: err });
      }
    }),

  /**
   * withdrawal.myHistory — authenticated
   * Returns the calling user's full withdrawal history.
   */
  myHistory: protectedProcedure.query(async ({ ctx }) => {
    // getUserWithdrawals returns amount as number — no mapping needed
    return getUserWithdrawals(ctx.userId!);
  }),

  /**
   * withdrawal.listPending — admin only
   * Returns all PENDING withdrawal requests for the admin queue.
   */
  listPending: adminProcedure.query(async () => {
    // listPendingWithdrawals returns amount as number — no mapping needed
    return listPendingWithdrawals();
  }),

  /**
   * withdrawal.approve — admin only
   * Approve a PENDING request: debits the user's ledger balance and sets
   * status to APPROVED. Runs reconciliation invariant check.
   */
  approve: adminProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ipAddress =
        ctx.req.ip ?? ctx.req.socket.remoteAddress ?? "0.0.0.0";
      try {
        return await approveWithdrawal(ctx.userId!, input.requestId, ipAddress);
      } catch (err) {
        if (err instanceof WithdrawalError) {
          switch (err.code) {
            case "REQUEST_NOT_FOUND":
              throw new TRPCError({
                code: "NOT_FOUND",
                message: err.message,
              });
            case "REQUEST_NOT_PENDING":
            case "INSUFFICIENT_BALANCE":
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err.message,
              });
            case "RECONCILIATION_FAILED":
              console.error(
                "[withdrawal.approve] CRITICAL reconciliation failure:",
                err
              );
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message:
                  "Transaction integrity check failed. Please contact support.",
              });
            default:
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: err.message,
              });
          }
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: err });
      }
    }),

  /**
   * withdrawal.complete — admin only
   * Mark an APPROVED withdrawal as COMPLETED (payment physically sent).
   */
  complete: adminProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await completeWithdrawal(ctx.userId!, input.requestId);
        return { success: true, requestId: input.requestId };
      } catch (err) {
        if (err instanceof WithdrawalError) {
          switch (err.code) {
            case "REQUEST_NOT_FOUND":
              throw new TRPCError({
                code: "NOT_FOUND",
                message: err.message,
              });
            case "REQUEST_NOT_APPROVED":
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err.message,
              });
            default:
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: err.message,
              });
          }
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: err });
      }
    }),

  /**
   * withdrawal.reject — admin only
   * Reject a PENDING request. No balance change — user keeps their funds.
   */
  reject: adminProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const ipAddress =
        ctx.req.ip ?? ctx.req.socket.remoteAddress ?? "0.0.0.0";
      try {
        await rejectWithdrawal(ctx.userId!, input.requestId, ipAddress);
        return { success: true, requestId: input.requestId };
      } catch (err) {
        if (err instanceof WithdrawalError) {
          switch (err.code) {
            case "REQUEST_NOT_FOUND":
              throw new TRPCError({
                code: "NOT_FOUND",
                message: err.message,
              });
            case "REQUEST_NOT_PENDING":
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err.message,
              });
            default:
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: err.message,
              });
          }
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: err });
      }
    }),
});
