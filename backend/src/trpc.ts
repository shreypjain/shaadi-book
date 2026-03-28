import { initTRPC, TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface TRPCContext {
  req: Request;
  res: Response;
  /** Populated by authMiddleware after JWT verification */
  userId?: string;
  userRole?: "guest" | "admin";
  userPhone?: string;
}

export async function createContext(opts: {
  req: Request;
  res: Response;
}): Promise<TRPCContext> {
  const req = opts.req;
  return {
    req,
    res: opts.res,
    // Forwarded from authMiddleware (set on req by JWT verification)
    userId: req.userId,
    userRole: (req.userRole as "guest" | "admin" | undefined),
    userPhone: req.userPhone,
  };
}

// ---------------------------------------------------------------------------
// tRPC init
// ---------------------------------------------------------------------------

const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape }) {
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Authenticated procedure — requires a valid JWT in the Authorization header.
 * Populated by the auth middleware in src/middleware/auth.ts (Task 1.3).
 */
export const protectedProcedure = t.procedure.use(
  t.middleware(({ ctx, next }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        ...ctx,
        userId: ctx.userId,
        userRole: ctx.userRole ?? "guest",
      },
    });
  })
);

/**
 * Admin procedure — requires admin role.
 */
export const adminProcedure = protectedProcedure.use(
  t.middleware(({ ctx, next }) => {
    if (ctx.userRole?.toUpperCase() !== "ADMIN") {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({ ctx });
  })
);

// Re-export zod for use in routers
export { z };
