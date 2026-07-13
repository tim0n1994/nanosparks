import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episode = await prisma.episode.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      title: true,
      thumbnailUrl: true,
      createdAt: true,
      updatedAt: true,
      transcript: true,
    },
  });

  if (!episode) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...episode,
    hasTranscript: !!episode.transcript,
  });
}
