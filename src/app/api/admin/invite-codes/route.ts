/**
 * Invite codes API (PRD §A4 邀请制免费).
 * POST { count } — generate invite codes (admin).
 * GET — list all codes + status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateInviteCodes } from '@/lib/billing/invite-codes';
import { requireAdmin } from '@/lib/auth/roles';
import { logger } from '@/lib/logger';

export async function GET() {
  const guard = await requireAdmin();
  if ('unauthorized' in guard) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('forbidden' in guard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: 'invite.' } },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({
    success: true,
    codes: rows.map((r) => ({ code: r.key.replace('invite.', ''), status: r.value })),
  });
}

const schema = z.object({ count: z.number().int().min(1).max(100).default(1) });

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if ('unauthorized' in guard) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('forbidden' in guard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }
  const codes = await generateInviteCodes(parsed.data.count);
  logger.info('Admin generated invite codes', { actor: guard.userId, count: codes.length });
  return NextResponse.json({ success: true, codes });
}
