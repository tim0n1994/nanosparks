/**
 * Sitemap (C1 SEO) — lists all public content pages.
 *
 * Per PRD §C1: sitemap + 百度站长主动推送 + Google. We emit the public /p/[slug]
 * pages that have been published. ReadCount is used to prioritize fresh content.
 */

import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://nanosparks.example';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  type SourceRow = { publicSlug: string | null; updatedAt: Date };
  let sources: SourceRow[] = [];
  try {
    sources = await prisma.source.findMany({
      where: { publicSlug: { not: null } },
      select: { publicSlug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });
  } catch {
    // DB unavailable (e.g. build time) → empty sitemap rather than crash.
    return [];
  }

  return sources
    .filter((s): s is { publicSlug: string; updatedAt: Date } => Boolean(s.publicSlug))
    .map((s) => ({
      url: `${BASE}/p/${s.publicSlug}`,
      lastModified: s.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));
}
