import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const episode = await prisma.episode.findUnique({
    where: { id: params.id },
    include: {
      channel: true,
      analysis: {
        include: { references: true },
      },
    },
  });

  if (!episode) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(episode);
}
