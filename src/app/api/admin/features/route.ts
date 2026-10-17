/**
 * GET /api/admin/features  — all flags + full registry metadata (for grouped UI)
 * PUT /api/admin/features  — update a partial set of flags
 *
 * Admin-only. Returns 401 when unauthenticated, 403 when non-admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/roles';
import {
  getFeatureFlags,
  saveFeatureFlags,
  FLAG_REGISTRY,
  ALL_FLAG_KEYS,
  CATEGORY_META,
} from '@/lib/feature-flags';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireAdmin();
  if ('unauthorized' in guard) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('forbidden' in guard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const flags = await getFeatureFlags();
  return NextResponse.json({
    flags,
    registry: FLAG_REGISTRY,
    categories: CATEGORY_META,
  });
}

const partialFlags = z.object(
  Object.fromEntries(ALL_FLAG_KEYS.map((k) => [k, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>,
);

export async function PUT(request: NextRequest) {
  const guard = await requireAdmin();
  if ('unauthorized' in guard) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('forbidden' in guard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = partialFlags.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  await saveFeatureFlags(parsed.data as Record<string, boolean>);
  const flags = await getFeatureFlags();
  logger.info('Admin updated feature flags', { actor: guard.userId, updates: parsed.data });
  return NextResponse.json({ flags });
}
