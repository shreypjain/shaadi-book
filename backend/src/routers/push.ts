/**
 * Push Notification Router
 *
 * tRPC endpoints for managing Web Push subscriptions:
 *   push.subscribe     — save a push subscription
 *   push.unsubscribe   — remove a push subscription by endpoint
 *   push.vapidPublicKey — return the VAPID public key for client-side subscription
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { prisma } from "../db.js";

export const pushRouter = router({
  /**
   * push.vapidPublicKey — public (no auth needed)
   * Returns the VAPID public key so the frontend can subscribe.
   */
  vapidPublicKey: publicProcedure.query(() => {
    return {
      key: process.env["VAPID_PUBLIC_KEY"] ?? "",
    };
  }),

  /**
   * push.subscribe — authenticated
   * Save or update a push subscription for the current user.
   */
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      // Upsert: if same endpoint exists (maybe different user), update it
      await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
        },
        update: {
          userId,
          p256dh: input.p256dh,
          auth: input.auth,
        },
      });

      console.log(`[push] Subscription saved for user ${userId}`);
      return { subscribed: true };
    }),

  /**
   * push.unsubscribe — authenticated
   * Remove a push subscription by endpoint.
   */
  unsubscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await prisma.pushSubscription.delete({
          where: { endpoint: input.endpoint },
        });
      } catch {
        // Subscription may already be gone — that's fine
      }

      return { subscribed: false };
    }),
});
