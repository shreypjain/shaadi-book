/**
 * Admin Audit Log — PRD §7.4
 *
 * Records every admin action with timestamp, IP, admin ID, and structured
 * metadata. The admin_audit_logs table is INSERT-only by convention — the
 * application never UPDATEs or DELETEs audit entries.
 *
 * Actions are logged for all admin operations: market creation, resolution,
 * pause/void, withdrawal approval/rejection.
 */

import { prisma } from "../db.js";

// ---------------------------------------------------------------------------
// Enum mirror (Prisma client may not be generated in all environments)
// ---------------------------------------------------------------------------

/** Mirrors the AdminAction enum in schema.prisma. */
export type AuditAdminAction =
  | "CREATE_MARKET"
  | "RESOLVE_MARKET"
  | "PAUSE_MARKET"
  | "VOID_MARKET"
  | "APPROVE_WITHDRAWAL"
  | "REJECT_WITHDRAWAL";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LogAdminActionParams {
  /** UUID of the admin user performing the action. */
  adminId: string;
  action: AuditAdminAction;
  /**
   * UUID of the entity being acted on.
   * For market actions: market ID. For withdrawal actions: withdrawal request ID.
   */
  targetId: string;
  /** Structured metadata describing the action details. */
  metadata: Record<string, unknown>;
  /** Requester IP address for audit trail (e.g. ctx.req.ip). */
  ipAddress: string;
}

// ---------------------------------------------------------------------------
// logAdminAction
// ---------------------------------------------------------------------------

/**
 * Append a new entry to the admin audit log.
 *
 * This is a fire-and-remember insert — it should be called after the main
 * operation succeeds. If logging fails, log the error but do not bubble up
 * (audit logging is secondary to the primary operation).
 *
 * @returns The created entry's id and createdAt timestamp
 */
export async function logAdminAction(
  params: LogAdminActionParams
): Promise<{ id: string; createdAt: Date }> {
  const entry = await prisma.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      action: params.action,
      targetId: params.targetId,
      metadata: params.metadata,
      ipAddress: params.ipAddress,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });
  return entry;
}
