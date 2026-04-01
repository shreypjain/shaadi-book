/**
 * Market Suggestion tRPC Router
 *
 * Allows guests to propose new prediction market questions for admin review.
 *
 * Endpoints:
 *   suggest.submit      — authenticated users submit a suggestion (Zod validated)
 *   suggest.myList      — authenticated users see their own suggestions + status
 *   suggest.adminList   — admin-only, list all suggestions with status filter
 *   suggest.adminReview — admin-only, approve or reject with optional notes
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc.js";
import { prisma } from "../db.js";
import { createMarket, getMarketWithPrices } from "../services/marketService.js";
import { seedMarket, DEFAULT_SEED_CENTS } from "../services/houseSeeding.js";
import { notifyNewMarket } from "../services/notificationService.js";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const submitInput = z.object({
  questionText: z
    .string()
    .min(5, "Question must be at least 5 characters")
    .max(500, "Question must be 500 characters or fewer"),
  outcomes: z
    .array(z.string().min(1, "Outcome cannot be empty").max(100))
    .min(2, "At least 2 outcomes required")
    .max(5, "Maximum 5 outcomes allowed"),
  description: z.string().max(1000).optional(),
});

const adminReviewInput = z.object({
  suggestionId: z.string().uuid(),
  status: z.enum(["APPROVED", "REJECTED"]),
  adminNotes: z.string().max(500).optional(),
});

const adminListInput = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

// ---------------------------------------------------------------------------
// Helper: serialize a suggestion row for the API response
// ---------------------------------------------------------------------------

function serializeSuggestion(s: {
  id: string;
  userId: string;
  questionText: string;
  outcomes: unknown;
  description: string | null;
  status: string;
  adminNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: { name: string; phone: string };
}) {
  return {
    id: s.id,
    userId: s.userId,
    questionText: s.questionText,
    outcomes: s.outcomes as string[],
    description: s.description,
    status: s.status as "PENDING" | "APPROVED" | "REJECTED",
    adminNotes: s.adminNotes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    ...(s.user ? { userName: s.user.name, userPhone: s.user.phone } : {}),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const suggestRouter = router({
  /**
   * suggest.submit — authenticated
   *
   * Submit a new market suggestion. Guests can submit multiple suggestions.
   * Rate limiting is not enforced here — trust the UI / JWT to prevent abuse
   * at a small wedding scale.
   */
  submit: protectedProcedure
    .input(submitInput)
    .mutation(async ({ ctx, input }) => {
      const trimmedOutcomes = input.outcomes.map((o) => o.trim());

      const suggestion = await prisma.marketSuggestion.create({
        data: {
          userId: ctx.userId,
          questionText: input.questionText.trim(),
          outcomes: trimmedOutcomes,
          description: input.description?.trim() ?? null,
          status: "APPROVED",
        },
      });

      // Auto-create the market immediately — failures are non-fatal
      try {
        const marketId = await createMarket(
          ctx.userId!,
          suggestion.questionText,
          trimmedOutcomes
        );

        const market = await getMarketWithPrices(marketId);
        if (market) {
          const outcomeIds = market.outcomes.map((o) => o.id);
          seedMarket(marketId, outcomeIds, DEFAULT_SEED_CENTS).catch((err: unknown) => {
            console.error("[suggest.submit] House seeding failed:", err);
          });

          notifyNewMarket(market).catch((err: unknown) => {
            console.error("[suggest.submit] Notification failed:", err);
          });
        }
      } catch (err) {
        console.error("[suggest.submit] Auto-create market failed:", err);
      }

      return serializeSuggestion(suggestion);
    }),

  /**
   * suggest.myList — authenticated
   *
   * Returns all suggestions the logged-in user has submitted, newest first.
   */
  myList: protectedProcedure.query(async ({ ctx }) => {
    const suggestions = await prisma.marketSuggestion.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
    });

    return suggestions.map(serializeSuggestion);
  }),

  /**
   * suggest.adminList — admin only
   *
   * Returns all suggestions, optionally filtered by status. Newest first.
   * Includes submitter name + phone for context.
   */
  adminList: adminProcedure
    .input(adminListInput)
    .query(async ({ input }) => {
      const suggestions = await prisma.marketSuggestion.findMany({
        where: input.status ? { status: input.status } : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
        },
      });

      return suggestions.map(serializeSuggestion);
    }),

  /**
   * suggest.adminReview — admin only
   *
   * Approve or reject a suggestion with optional admin notes.
   */
  adminReview: adminProcedure
    .input(adminReviewInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.marketSuggestion.findUnique({
        where: { id: input.suggestionId },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suggestion not found",
        });
      }

      if (existing.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Suggestion is already ${existing.status.toLowerCase()}`,
        });
      }

      const updated = await prisma.marketSuggestion.update({
        where: { id: input.suggestionId },
        data: {
          status: input.status,
          adminNotes: input.adminNotes?.trim() ?? null,
        },
      });

      // Auto-create the market when a suggestion is approved.
      // Failures are caught and logged — the approval itself must not roll back.
      if (input.status === "APPROVED") {
        try {
          const marketId = await createMarket(
            ctx.userId!,
            updated.questionText,
            updated.outcomes as string[]
          );

          // Seed $20/outcome (house liquidity) — fire-and-forget, errors are non-fatal.
          const market = await getMarketWithPrices(marketId);
          if (market) {
            const outcomeIds = market.outcomes.map((o) => o.id);
            seedMarket(marketId, outcomeIds, DEFAULT_SEED_CENTS).catch((err: unknown) => {
              console.error("[suggest.adminReview] House seeding failed:", err);
            });
          }
        } catch (err) {
          console.error(
            "[suggest.adminReview] Auto-create market failed for suggestion",
            input.suggestionId,
            err
          );
        }
      }

      return serializeSuggestion(updated);
    }),
});
