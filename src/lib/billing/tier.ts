/**
 * User tier (PRD §7 定价: Free / Pro ¥29/月).
 *
 * Determines whether a user is on the Pro plan, which grants queue priority
 * (PRD §A4 付费用户队列优先), higher quotas (60 集/月), and bilingual/package
 * features. The source of truth is a Setting keyed by user id; for now we
 * default to Free (the A阶段 is invite-only free).
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type UserTier = 'free' | 'pro';

/** Pro monthly first-transcription quota (PRD §7: Pro 60 集/月). */
export const PRO_MONTHLY_QUOTA = 60;
/** Free monthly first-transcription quota (PRD §7: Free 4 集/月). */
export const FREE_MONTHLY_QUOTA = 4;

/**
 * Look up a user's tier. Reads the `tier.<userId>` Setting; defaults to free.
 * In production this is backed by the billing/subscription system.
 */
export async function getUserTier(userId: string): Promise<UserTier> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: `tier.${userId}` } });
    return row?.value === 'pro' ? 'pro' : 'free';
  } catch (err) {
    logger.warn('tier lookup failed, defaulting to free', { userId, error: String(err) });
    return 'free';
  }
}

/** True when the user has Pro (queue priority + higher quota). */
export function isPro(tier: UserTier): boolean {
  return tier === 'pro';
}

/** The monthly first-transcription quota for a tier (PRD §7). */
export function monthlyQuotaFor(tier: UserTier): number {
  return tier === 'pro' ? PRO_MONTHLY_QUOTA : FREE_MONTHLY_QUOTA;
}
