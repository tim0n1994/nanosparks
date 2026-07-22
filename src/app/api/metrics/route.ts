/**
 * GET /api/metrics — PRD §9 指标体系 report endpoint.
 *
 * Exposes the §9 metric layers (north-star / cost / distribution) so an admin
 * dashboard can render weekly-finished-reads, cache-hit rate, avg cost, and the
 * distribution funnel. Reads-only; safe to call frequently.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { getNorthStarMetrics, getCostMetrics, getDistributionMetrics } from '@/lib/metrics';

export async function GET(_request: NextRequest) {
  // Admin-only in production; dev/E2E bypasses auth.
  if (isValidClerkKey) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const [northStar, cost, distribution] = await Promise.all([
    getNorthStarMetrics(),
    getCostMetrics(),
    getDistributionMetrics(),
  ]);

  return NextResponse.json({
    success: true,
    northStar,
    cost,
    distribution,
  });
}
