import type { Prisma } from '@prisma/client';
import { logger } from '../../config/logger';
import { prisma } from '../../lib/prisma';

export interface AuditEntry {
  actorId?: string | null;
  institutionId?: string | null;
  action: string; // e.g. "auth.login", "auth.password_reset"
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonObject;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Writes one append-only audit record. A failure to write is logged but must never
// break the action being audited.
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        institutionId: entry.institutionId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent?.slice(0, 255) ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}