import { config as loadEnv } from 'dotenv'; loadEnv();
import { prisma } from '@/lib/prisma';
import { createWindows } from '@/lib/extraction/windowed-extraction';
async function main() {
  const cid = 'cmrxu6wt90019mtyfoafzl6qs';
  const turns = await prisma.turn.findMany({
    where: { conversationId: cid },
    orderBy: { turnIndex: 'asc' },
    include: { participant: { select: { name: true } } },
  });
  const turnLikes = turns.map((t) => ({
    turnIndex: t.turnIndex, startMs: t.startMs, endMs: t.endMs, text: t.text,
    speakerLabel: t.participant?.name ?? undefined,
  }));
  const windows = createWindows(turnLikes);
  console.log(JSON.stringify({
    totalTurns: turns.length,
    totalChars: turns.reduce((n,t)=>n+t.text.length,0),
    windowsCreated: windows.length,
    firstWindow: { turns: windows[0]?.turnIndices?.length, chars: windows[0]?.text?.length, endMs: windows[0]?.endMs },
    lastWindow: { endMs: windows[windows.length-1]?.endMs },
    windowEndTimes: windows.map(w => w.endMs).slice(0, 50),
  }, null, 2));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);process.exit(1);});
