/**
 * Admin Audit Log Service — Task 2.3
 *
 * Immutable log of every admin action. Stored in admin_audit_logs table.
 * Used for compliance, debugging, and tamper detection.
 *
 * References:
 *   PRD §7.4 — Admin audit log
 */

import type { AdminAuditLog, AdminAction, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// logAdminAction
// ---------------------------------------------------------------------------

/**
 * Record an admin action in the audit log.
 *
 * @param adminId   - UUID of the admin user performing the action.
 * @param action    - The action type (AdminAction enum).
 * @param targetId  - UUID of the entity being acted upon (market, user, etc.).
 * @param metadata  - Arbitrary JSON payload with context (e.g. outcome IDs).
 * @param ipAddress - The admin's IP address from the HTTP request.
 * @returns The created AdminAuditLog row.
 */
export async function logAdminAction(
  adminId: string,
  action: AdminAction,
  targetId: string,
  metadata: Prisma.InputJsonValue,
  ipAddress: string
): Promise<AdminAuditLog> {
  return prisma.adminAuditLog.create({
    data: {
      adminId,
      action,
      targetId,
      metadata,
      ipAddress,
    },
  });
}

// ---------------------------------------------------------------------------
// getRecentAuditLog
// ---------------------------------------------------------------------------

export interface AuditLogPage {
  entries: AdminAuditLog[];
  /** ID of the last entry returned — pass as `cursor` for the next page. */
  nextCursor: string | null;
}

/**
 * Return a paginated list of recent audit log entries (newest first).
 *
 * @param limit  - Max rows per page (1–100, default 50).
 * @param cursor - ID of the last row from the previous page (exclusive).
 */
export async function getRecentAuditLog(
  limit = 50,
  cursor?: string
): Promise<AuditLogPage> {
  const take = Math.min(Math.max(1, limit), 100);

  const entries = await prisma.adminAuditLog.findMany({
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { createdAt: "desc" },
  });

  const nextCursor =
    entries.length === take ? (entries[entries.length - 1]?.id ?? null) : null;

  return { entries, nextCursor };
}
