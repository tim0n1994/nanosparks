/**
 * 修正 TU.participantId 与 EvidenceSpan.turnId 指向的 turn 的 participantId 不一致问题。
 * 规则：TU 的归属应该 = 其 EvidenceSpan 的 turn 的 participantId（说话人）。
 * 之前 reattribute-tus 在不同归属状态下回填，导致 TU.participantId 与 evidence turn 不匹配。
 * 
 * Usage: npx tsx scripts/fix-tu-participant-consistency.ts [conversationId]
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';

async function fixConversation(conversationId: string): Promise<{ scanned: number; fixed: number }> {
  const tus = await prisma.thoughtUnit.findMany({
    where: { conversationId },
    select: {
      id: true, participantId: true,
      evidenceSpans: { select: { turnId: true, turn: { select: { participantId: true } } }, take: 1 },
    },
  });
  let scanned = 0, fixed = 0;
  for (const tu of tus) {
    scanned++;
    const evidenceParticipantId = tu.evidenceSpans[0]?.turn?.participantId ?? null;
    if (tu.participantId !== evidenceParticipantId) {
      await prisma.thoughtUnit.update({
        where: { id: tu.id },
        data: { participantId: evidenceParticipantId },
      });
      fixed++;
    }
  }
  return { scanned, fixed };
}

async function main() {
  const target = process.argv[2];
  const convIds = target ? [target] : (await prisma.thoughtUnit.findMany({
    where: { participantId: { not: null } },
    select: { conversationId: true },
    distinct: ['conversationId' as never],
  })).map((t: { conversationId: string }) => t.conversationId);
  console.log(JSON.stringify({ msg: 'fix start', conversations: convIds.length }));
  let totalFixed = 0;
  for (const cid of convIds) {
    const r = await fixConversation(cid);
    totalFixed += r.fixed;
    if (r.fixed > 0) console.log(JSON.stringify({ msg: 'fix conv', conversationId: cid, ...r }));
  }
  console.log(JSON.stringify({ msg: 'fix done', conversations: convIds.length, totalFixed }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(JSON.stringify({ msg: 'fix failed', error: String(e), stack: e?.stack })); process.exit(1); });
