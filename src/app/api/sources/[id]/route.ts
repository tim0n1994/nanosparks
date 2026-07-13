/**
 * GET /api/sources/:id
 * GET /api/sources/:id/status
 *
 * Source details and processing status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const source = await prisma.source.findUnique({
      where: { id: params.id },
      include: {
        mediaAssets: true,
        conversations: {
          include: {
            _count: { select: { turns: true, participants: true, thoughtUnits: true } },
          },
        },
        corpus: {
          select: { id: true, name: true },
        },
      },
    });

    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    return NextResponse.json(source);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch source' }, { status: 500 });
  }
}
