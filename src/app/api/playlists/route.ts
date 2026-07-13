import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { nanoid } from 'nanoid';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export async function GET() {
  const playlists = await prisma.playlist.findMany({
    include: { _count: { select: { episodes: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ playlists });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description } = createSchema.parse(body);

    const playlist = await prisma.playlist.create({
      data: {
        name,
        description,
        userId: 'anonymous',
        shareId: nanoid(10),
      },
    });

    return NextResponse.json({ success: true, playlist });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
