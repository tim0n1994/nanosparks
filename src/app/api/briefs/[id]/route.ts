/**
 * GET    /api/briefs/:id — get brief details
 * PATCH  /api/briefs/:id — update brief (title, sections, visibility)
 * DELETE /api/briefs/:id — delete brief
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  sections: z.array(z.object({
    heading: z.string(),
    content: z.string(),
    citations: z.array(z.object({
      thoughtUnitId: z.string(),
      quote: z.string(),
    })).optional(),
  })).optional(),
  visibility: z.enum(['private', 'workspace', 'shared_link', 'public']).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const brief = await prisma.brief.findUnique({ where: { id } });

    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'Brief not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: brief });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch brief' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues },
        { status: 400 },
      );
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.title) data.title = parsed.data.title;
    if (parsed.data.sections) data.sectionsJson = parsed.data.sections;
    if (parsed.data.visibility) {
      data.visibility = parsed.data.visibility;
      if (parsed.data.visibility === 'shared_link') {
        data.shareId = nanoid(12);
      }
    }

    const brief = await prisma.brief.update({ where: { id }, data });

    return NextResponse.json({ success: true, data: brief });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to update brief' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await prisma.brief.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to delete brief' },
      { status: 500 },
    );
  }
}
