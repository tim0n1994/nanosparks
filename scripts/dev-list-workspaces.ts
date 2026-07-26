/** Dev utility: list workspaces with clerkId + this-month first-transcription counts. */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';

async function main() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const ws = await prisma.workspace.findMany({ select: { id: true, clerkId: true, name: true } });
  const out = [];
  for (const w of ws) {
    const used = await prisma.conversation.count({
      where: { createdAt: { gte: monthStart }, isSharedCache: true, source: { corpus: { workspaceId: w.id } } },
    });
    const tierRow = w.clerkId ? await prisma.setting.findUnique({ where: { key: `tier.${w.clerkId}` } }) : null;
    out.push({ workspace: w.name, clerkId: w.clerkId, usedThisMonth: used, tier: tierRow?.value ?? 'free' });
  }
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
