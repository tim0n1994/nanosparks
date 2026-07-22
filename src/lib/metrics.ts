/**
 * Product metrics (PRD §9 指标体系).
 *
 * North star: 周完读集数 (scrollRatio ≥ 0.7 OR dwell ≥ 3min).
 * Activation: 注册 → 24h 内首集完读.
 * Retention: D7 / W4.
 * Distribution: 完读→生成图文包率；图文包→标记已发布率.
 * Growth: 公开页 UV、搜索流量占比、UV→注册转化.
 * Cost: 平均单集成本、缓存命中率.
 *
 * ReadingProgress.completedAt already records finished-reads; this module
 * aggregates it into the §9 report layers without a separate events table.
 */

import { prisma } from '@/lib/prisma';

export interface NorthStarMetrics {
  weeklyFinishedReads: number;
  weeklyDistinctFinishers: number;
}

/** Count finished reads in the last 7 days (scrollRatio ≥ 0.7 sets completedAt). */
export async function getNorthStarMetrics(): Promise<NorthStarMetrics> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [reads, distinctUsers] = await Promise.all([
    prisma.readingProgress.count({ where: { completedAt: { gte: since } } }),
    prisma.readingProgress.groupBy({
      by: ['userId'],
      where: { completedAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  return { weeklyFinishedReads: reads, weeklyDistinctFinishers: distinctUsers.length };
}

export interface CostMetrics {
  avgCostPerEpisodeCny: number;
  cacheHitRate: number;
}

/**
 * Average per-episode cost + cache hit rate over the last N days.
 * costUsd is summed from ExtractionRun; cache hit rate from readCount growth vs
 * fresh transcriptions.
 */
export async function getCostMetrics(days = 30): Promise<CostMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [runs, episodes] = await Promise.all([
    prisma.extractionRun.aggregate({
      _sum: { costUsd: true },
      _count: { _all: true },
      where: { finishedAt: { gte: since } },
    }),
    prisma.globalEpisode.aggregate({
      _sum: { readCount: true },
      _count: { _all: true },
      where: { createdAt: { gte: since } },
    }),
  ]);

  const totalCostUsd = runs._sum.costUsd ?? 0;
  const freshCount = episodes._count._all || 1;
  const avgCostUsd = totalCostUsd / freshCount;
  const avgCostCny = avgCostUsd * 7.2;

  // Cache hit rate ≈ 1 - (fresh transcriptions / total reads). When reads >> fresh,
  // most reads were cache hits.
  const totalReads = episodes._sum.readCount ?? 0;
  const cacheHitRate = totalReads > 0 ? Math.max(0, 1 - freshCount / totalReads) : 0;

  return {
    avgCostPerEpisodeCny: Math.round(avgCostCny * 100) / 100,
    cacheHitRate: Math.round(cacheHitRate * 1000) / 1000,
  };
}

export interface DistributionMetrics {
  readToPackageRate: number;
  packageToPublishedRate: number;
}

/**
 * Distribution funnel (PRD §9 分发环).
 * 完读→生成图文包率 and 图文包→标记已发布率.
 */
export async function getDistributionMetrics(days = 30): Promise<DistributionMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [finishedReads, packages, publishedPackages] = await Promise.all([
    prisma.readingProgress.count({ where: { completedAt: { gte: since } } }),
    prisma.publishPackage.count({ where: { createdAt: { gte: since } } }),
    prisma.publishPackage.count({ where: { status: 'published', updatedAt: { gte: since } } }),
  ]);

  return {
    readToPackageRate: finishedReads > 0 ? packages / finishedReads : 0,
    packageToPublishedRate: packages > 0 ? publishedPackages / packages : 0,
  };
}

/** A pure helper for tests: finished-read counts → activation rate. */
export function activationRate(firstReads24h: number, newUsers: number): number {
  if (newUsers === 0) return 0;
  return firstReads24h / newUsers;
}
