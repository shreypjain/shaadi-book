import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import {
  normalizePhone,
  sendOTP,
  verifyOTP,
  generateToken,
} from "../services/auth.js";
import { isAdminPhone } from "../middleware/auth.js";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Pending-user store
// Holds { name, country } keyed by normalized phone until OTP is verified.
// Entries expire after 10 minutes (same as Twilio OTP TTL).
// A single-instance in-memory map is acceptable for this app's scale.
// ---------------------------------------------------------------------------

interface PendingUser {
  name: string;
  country: "US" | "IN";
  expiresAt: number;
}

const pendingUsers = new Map<string, PendingUser>();

const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

function setPending(phone: string, name: string, country: "US" | "IN"): void {
  pendingUsers.set(phone, {
    name,
    country,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
}

function getPending(phone: string): PendingUser | null {
  const entry = pendingUsers.get(phone);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingUsers.delete(phone);
    return null;
  }
  return entry;
}

function deletePending(phone: string): void {
  pendingUsers.delete(phone);
}

// ---------------------------------------------------------------------------
// Auth router
// ---------------------------------------------------------------------------

export const authRouter = router({
  /**
   * auth.checkPhone
   * Checks whether a phone number already has a registered account.
   * Used by the login UI to skip the name field for returning users.
   */
  checkPhone: publicProcedure
    .input(
      z.object({
        phone: z.string().min(1),
        country: z.enum(["US", "IN"]),
      })
    )
    .mutation(async ({ input }) => {
      const normalizedPhone = normalizePhone(input.phone, input.country);
      const existing = await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
      });
      return { exists: Boolean(existing) };
    }),

  /**
   * auth.sendOTP
   * Normalizes phone, dispatches OTP via Twilio Verify.
   * Stores name/country in pending map for user creation on verify.
   * `name` is required only for new users; omit it for returning users.
   */
  sendOTP: publicProcedure
    .input(
      z.object({
        phone: z.string().min(1),
        country: z.enum(["US", "IN"]),
        name: z.string().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const normalizedPhone = normalizePhone(input.phone, input.country);

      // Check whether the user already exists
      const existingUser = await prisma.user.findUnique({
        where: { phone: normalizedPhone },
        select: { id: true },
      });

      // New users must provide a name
      if (!existingUser) {
        if (!input.name) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Name is required for new accounts.",
          });
        }
        setPending(normalizedPhone, input.name, input.country);
      }

      try {
        await sendOTP(normalizedPhone);
      } catch (err) {
        // Clean up pending entry if OTP dispatch fails
        if (!existingUser) deletePending(normalizedPhone);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send OTP. Please try again.",
          cause: err,
        });
      }

      return { status: "pending" as const };
    }),

  /**
   * auth.verifyOTP
   * Verifies OTP, creates user if new (admin role for admin phones), returns JWT.
   */
  verifyOTP: publicProcedure
    .input(
      z.object({
        phone: z.string().min(1),
        country: z.enum(["US", "IN"]),
        code: z.string().length(6),
      })
    )
    .mutation(async ({ input }) => {
      const normalizedPhone = normalizePhone(input.phone, input.country);

      const approved = await verifyOTP(normalizedPhone, input.code);
      if (!approved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired OTP code.",
        });
      }

      // Find or create user
      let user = await prisma.user.findUnique({
        where: { phone: normalizedPhone },
      });

      if (!user) {
        const pending = getPending(normalizedPhone);
        if (!pending) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Registration session expired. Please request a new OTP.",
          });
        }

        const role = isAdminPhone(normalizedPhone) ? "ADMIN" : "GUEST";

        user = await prisma.user.create({
          data: {
            name: pending.name,
            phone: normalizedPhone,
            country: pending.country,
            role,
          },
        });

        deletePending(normalizedPhone);
      }

      // Role in JWT uses lowercase to match TRPCContext
      const jwtRole = user.role === "ADMIN" ? "admin" : "guest";
      const token = generateToken(user.id, jwtRole, user.phone);

      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          country: user.country,
          role: jwtRole,
        },
      };
    }),

  /**
   * auth.me
   * Returns the currently authenticated user's profile.
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        id: true,
        name: true,
        phone: true,
        country: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
    }

    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      country: user.country,
      role: user.role === "ADMIN" ? ("admin" as const) : ("guest" as const),
      createdAt: user.createdAt,
    };
  }),
});
