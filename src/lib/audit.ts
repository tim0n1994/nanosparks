/**
 * Audit Log Helper
 *
 * Per Track F.3: write audit events for view/export/share/delete/settings-change.
 * Model AuditLog already exists in schema (added in I2).
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';

export type AuditAction = 'view' | 'export' | 'share' | 'delete' | 'settings_change';

export interface AuditEntry {
  workspaceId?: string;
  actorId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit log entry. Non-blocking — failures are logged but don't throw.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadataJson: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    logger.warn('Failed to write audit log', { error: String(error), entry });
  }
}
