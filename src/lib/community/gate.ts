/**
 * Community gate (C4) — PRD §C4 数据闸门.
 *
 * Social features (高亮即评论 / 话题小组 / 主播认领) only unlock once there is
 * enough activity to avoid cold-start failure:
 *   C1 周 UV > 1,000   OR   C2 周高亮用户 > 100
 */

import { prisma } from '@/lib/prisma';

export interface CommunityGateConfig {
  weeklyUvThreshold: number;
  weeklyHighlightUsersThreshold: number;
}

export const DEFAULT_GATE: CommunityGateConfig = {
  weeklyUvThreshold: Number(process.env.COMMUNITY_GATE_WEEKLY_UV ?? 1000),
  weeklyHighlightUsersThreshold: Number(process.env.COMMUNITY_GATE_WEEKLY_HIGHLIGHT_USERS ?? 100),
};

export interface GateResult {
  unlocked: boolean;
  weeklyUv: number;
  weeklyHighlightUsers: number;
  reasons: string[];
}

/**
 * Evaluate the community gate against the last 7 days of activity.
 * unlocked === true when EITHER threshold is met (PRD uses "或").
 *
 * Note: weeklyUv uses "GlobalEpisodes read in the window" as a coarse proxy for
 * distinct visitors (a real UV metric needs an events table). This is documented
 * honestly rather than pretending it is true UV.
 */
export async function evaluateCommunityGate(
  cfg: CommunityGateConfig = DEFAULT_GATE,
): Promise<GateResult> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [weeklyEpisodesTouched, weeklyHighlightUsers] = await Promise.all([
    prisma.globalEpisode.count({
      where: { updatedAt: { gte: since }, readCount: { gt: 0 } },
    }),
    prisma.highlight.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const reasons: string[] = [];
  if (weeklyEpisodesTouched >= cfg.weeklyUvThreshold) {
    reasons.push(`周 UV 代理 ${weeklyEpisodesTouched} ≥ ${cfg.weeklyUvThreshold}`);
  }
  if (weeklyHighlightUsers.length >= cfg.weeklyHighlightUsersThreshold) {
    reasons.push(`周高亮用户 ${weeklyHighlightUsers.length} ≥ ${cfg.weeklyHighlightUsersThreshold}`);
  }

  return {
    unlocked: reasons.length > 0,
    weeklyUv: weeklyEpisodesTouched,
    weeklyHighlightUsers: weeklyHighlightUsers.length,
    reasons,
  };
}

/** Pure predicate for tests + UI feature-flags without a DB hit. */
export function gateUnlockedFromCounts(
  weeklyUv: number,
  weeklyHighlightUsers: number,
  cfg: CommunityGateConfig = DEFAULT_GATE,
): boolean {
  return (
    weeklyUv >= cfg.weeklyUvThreshold ||
    weeklyHighlightUsers >= cfg.weeklyHighlightUsersThreshold
  );
}
