/**
 * Retention Job
 *
 * Per Track F.1: Daily scan of MediaAsset and conversation data with
 * delete_after_* retention policies. Deletes expired objects from storage
 * and writes an audit log entry for each deletion.
 *
 * Policies:
 *   - delete_after_processing: delete media after transcription completes
 *   - delete_after_30d: delete 30 days after creation
 *   - delete_after_90d: delete 90 days after creation
 *   - keep: never delete (default)
 *
 * Runs as a scheduled BullMQ job (daily).
 */

import { prisma } from '@/lib/prisma';
import { createStorageProvider } from '@/lib/storage/provider';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

interface RetentionJobData {
  /** Override policy for manual runs */
  dryRun?: boolean;
}

export async function processRetentionJob(data: RetentionJobData = {}): Promise<void> {
  const { dryRun = false } = data;

  logger.info('Retention job started', { dryRun });

  const now = new Date();
  let deletedAssets = 0;
  let deletedConversations = 0;
  let errors = 0;

  // ── Scan MediaAssets with delete_after_* policies ──
  const assets = await prisma.mediaAsset.findMany({
    where: {
      retentionPolicy: { startsWith: 'delete_after_' },
    },
    include: {
      source: {
        select: { id: true, status: true, consentStatus: true, corpusId: true },
      },
    },
  });

  for (const asset of assets) {
    try {
      const policy = asset.retentionPolicy;
      let shouldDelete = false;

      if (policy === 'delete_after_processing') {
        // Delete if source is completed or failed
        if (asset.source.status === 'completed' || asset.source.status === 'failed') {
          shouldDelete = true;
        }
      } else if (policy === 'delete_after_30d') {
        const ageMs = now.getTime() - asset.createdAt.getTime();
        if (ageMs > 30 * 24 * 60 * 60 * 1000) {
          shouldDelete = true;
        }
      } else if (policy === 'delete_after_90d') {
        const ageMs = now.getTime() - asset.createdAt.getTime();
        if (ageMs > 90 * 24 * 60 * 60 * 1000) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        if (dryRun) {
          logger.info('Retention: would delete asset', { assetId: asset.id, policy });
          continue;
        }

        // Delete from object storage
        if (asset.storageKey) {
          try {
            const storage = createStorageProvider();
            await storage.delete(asset.storageKey);
          } catch (e) {
            logger.warn('Retention: storage delete failed', { assetId: asset.id, error: String(e) });
          }
        }

        // Delete from database
        await prisma.mediaAsset.delete({ where: { id: asset.id } });

        // Write audit log
        await audit({
          action: 'delete',
          resourceType: 'MediaAsset',
          resourceId: asset.id,
          metadata: { policy, sourceId: asset.sourceId },
        });

        deletedAssets++;
      }
    } catch (error) {
      logger.error('Retention: asset processing failed', { assetId: asset.id, error: String(error) });
      errors++;
    }
  }

  // ── Scan Sources with delete_after_* retention policies ──
  const sources = await prisma.source.findMany({
    where: {
      retentionPolicy: { startsWith: 'delete_after_' },
    },
    select: { id: true, retentionPolicy: true, status: true, createdAt: true, corpusId: true },
  });

  for (const source of sources) {
    try {
      const policy = source.retentionPolicy;
      let shouldDelete = false;

      if (policy === 'delete_after_processing') {
        if (source.status === 'completed' || source.status === 'failed') {
          shouldDelete = true;
        }
      } else if (policy === 'delete_after_30d') {
        const ageMs = now.getTime() - source.createdAt.getTime();
        if (ageMs > 30 * 24 * 60 * 60 * 1000) {
          shouldDelete = true;
        }
      } else if (policy === 'delete_after_90d') {
        const ageMs = now.getTime() - source.createdAt.getTime();
        if (ageMs > 90 * 24 * 60 * 60 * 1000) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        if (dryRun) {
          logger.info('Retention: would delete source', { sourceId: source.id, policy });
          continue;
        }

        // Delete source (cascades to mediaAssets, conversations, turns, etc.)
        await prisma.source.delete({ where: { id: source.id } });

        await audit({
          action: 'delete',
          resourceType: 'Source',
          resourceId: source.id,
          metadata: { policy, corpusId: source.corpusId },
        });

        deletedConversations++;
      }
    } catch (error) {
      logger.error('Retention: source processing failed', { sourceId: source.id, error: String(error) });
      errors++;
    }
  }

  logger.info('Retention job completed', {
    deletedAssets,
    deletedConversations,
    errors,
    dryRun,
  });
}
