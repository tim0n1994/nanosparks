/**
 * Free-tier quota accounting (PRD §7 定价).
 *
 * The product-defining rule: cache hits do NOT consume the free quota, while
 * fresh first-time transcriptions do. This is what makes "hot episodes free for
 * everyone" economically viable while cold episodes still cost. PRD §7 Free:
 * 4 集/月首转额度；缓存命中的集不占额度、无限读。
 *
 * This module counts only *first-time transcriptions* (cache misses) toward the
 * monthly quota; cache hits are unlimited reads.
 */

import { prisma } from '@/lib/prisma';

export interface QuotaConfig {
  freeMonthlyFirstTranscriptions: number;
}

export const DEFAULT_QUOTA: QuotaConfig = {
  freeMonthlyFirstTranscriptions: Number(process.env.FREE_MONTHLY_FIRST_TRANSCRIPTIONS ?? 4),
};

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  /** True when the user can submit another first-time transcription this month. */
  canTranscribe: boolean;
}

/**
 * Count a user's first-time transcriptions in the current calendar month.
 * A first-time transcription is a Conversation with isSharedCache=true that the
 * user's corpus *created* (not just referenced). Cache hits (isSharedCache but
 * created by another user earlier) are excluded.
 *
 * We approximate "created by this user" via the corpus → workspace.clerkId link.
 */
export async function getMonthlyQuotaStatus(
  userId: string,
  cfg: QuotaConfig = DEFAULT_QUOTA,
): Promise<QuotaStatus> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const used = await prisma.conversation.count({
    where: {
      createdAt: { gte: monthStart },
      isSharedCache: true,
      source: { corpus: { workspace: { clerkId: userId } } },
    },
  });

  const remaining = Math.max(0, cfg.freeMonthlyFirstTranscriptions - used);
  return {
    used,
    limit: cfg.freeMonthlyFirstTranscriptions,
    remaining,
    canTranscribe: remaining > 0,
  };
}

/**
 * Pure helper: decide whether a resolve outcome consumes quota.
 * Cache hits (cached:true) never consume quota — they are unlimited reads.
 * Only first-time transcriptions (cached:false) count.
 */
export function consumesQuota(cached: boolean): boolean {
  return !cached;
}

/**
 * Pure helper for tests + UI: given used + limit, is another first-transcription allowed?
 */
export function canTranscribeFromCounts(used: number, limit: number): boolean {
  return used < limit;
}
