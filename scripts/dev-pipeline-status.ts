/** Dev utility: recent conversations with pipeline status + turn/claim counts. */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';

async function main() {
  const convos = await prisma.conversation.findMany({
    orderBy: { createdAt: 'desc' },
    take: Number(process.argv[2] ?? 6),
    select: {
      id: true, title: true, status: true, createdAt: true,
      globalEpisode: { select: { durationSec: true } },
      _count: { select: { turns: true, thoughtUnits: true, participants: true } },
    },
  });
  const out = convos.map((c) => ({
    id: c.id,
    title: (c.title ?? '').slice(0, 40),
    status: c.status,
    durationSec: c.globalEpisode?.durationSec ?? null,
    turns: c._count.turns,
    tus: c._count.thoughtUnits,
    participants: c._count.participants,
    ageMin: Math.round((Date.now() - c.createdAt.getTime()) / 60000),
  }));
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
