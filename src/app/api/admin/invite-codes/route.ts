/**
 * Invite codes API (PRD §A4 邀请制免费).
 * POST { count } — generate invite codes (admin).
 * GET — list all codes + status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateInviteCodes } from '@/lib/billing/invite-codes';

export async function GET() {
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
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }
  const codes = await generateInviteCodes(parsed.data.count);
  return NextResponse.json({ success: true, codes });
}
