import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/auth.js";

// ---------------------------------------------------------------------------
// Type augmentation — attach auth fields to Express Request
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
      userPhone?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Admin phone check
// ---------------------------------------------------------------------------

/**
 * Returns true if the given E.164 phone number is in the ADMIN_PHONE_NUMBERS
 * environment variable (comma-separated list).
 */
export function isAdminPhone(phone: string): boolean {
  const raw = process.env["ADMIN_PHONE_NUMBERS"] ?? "";
  const adminPhones = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return adminPhones.includes(phone);
}

// ---------------------------------------------------------------------------
// JWT extraction middleware
// ---------------------------------------------------------------------------

/**
 * Extracts and verifies a Bearer JWT from the Authorization header.
 * Populates req.userId, req.userRole, req.userPhone on success.
 * Does NOT reject the request if there is no token (unprotected routes
 * still pass through — the tRPC protectedProcedure handles rejection).
 */
export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    req.userRole = payload.role;
    req.userPhone = payload.phone;
  } catch {
    // Invalid/expired token — leave req.userId undefined so protectedProcedure
    // rejects with UNAUTHORIZED.
  }
  next();
}

// ---------------------------------------------------------------------------
// Admin-only middleware (for plain Express routes outside tRPC)
// ---------------------------------------------------------------------------

/**
 * Rejects requests where the authenticated user does not have role 'admin'.
 * Must be used after authMiddleware.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
