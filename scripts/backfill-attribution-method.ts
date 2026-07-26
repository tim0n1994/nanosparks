/**
 * 回填历史归属 turns 的 attributionMethod/Confidence（PRD §5.4）。
 *
 * 背景：在加 attributionMethod/Confidence 字段之前归属的 turns，这两列是 NULL，
 * 导致质量门的 attributionConfidenceMedian=0，误拦已正确归属的集不进蒸馏层。
 *
 * 策略：对每个有归属但缺 method 的 turn，按其归属来源标 method：
 *   - 有 diarization segments 覆盖该时间窗 -> diarization（从持久化分段真实重推导，
 *     confidence 与 live 路径同为 0.9）
 *   - 否则（来自 LLM merge / 旧路径，无法重推导）-> backfill，confidence = null
 *     （出处不可考就是不可考；标成 dialogue/0.9 会让质量门给自己写的常量打分）。
 * method='backfill' 的行不参与质量门的置信中位数（见 distillation-pipeline）。
 *
 * Usage: npx tsx scripts/backfill-attribution-method.ts [conversationId]
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { assignSpeaker } from '@/lib/transcription/normalize-turns';

async function backfillConversation(conversationId: string): Promise<{ scanned: number; updated: number }> {
  const turns = await prisma.turn.findMany({
    where: { conversationId, attributionMethod: null, participantId: { not: null } },
    select: { id: true, startMs: true, endMs: true },
  });
  if (turns.length === 0) return { scanned: 0, updated: 0 };

  const segs = await prisma.diarizationSegment.findMany({
    where: { conversationId },
    select: { label: true, startMs: true, endMs: true },
  });
  const speakerSegs = segs.map((s) => ({ label: s.label, startMs: s.startMs, endMs: s.endMs }));
  let updated = 0;
  for (const t of turns) {
    const hasDiarization = segs.length > 0 && assignSpeaker(t.startMs, t.endMs, speakerSegs) !== undefined;
    await prisma.turn.update({
      where: { id: t.id },
      data: hasDiarization
        ? { attributionMethod: 'diarization', attributionConfidence: 0.9 }
        : { attributionMethod: 'backfill', attributionConfidence: null },
    });
    updated++;
  }
  return { scanned: turns.length, updated };
}

async function main() {
  const target = process.argv[2];
  const convIds = target
    ? [target]
    : (await prisma.turn.findMany({ where: { attributionMethod: null }, select: { conversationId: true }, distinct: ['conversationId'] })).map((t) => t.conversationId);
  console.log(JSON.stringify({ msg: 'backfill start', conversations: convIds.length }));
  let totalUpdated = 0;
  for (const cid of convIds) {
    const r = await backfillConversation(cid);
    totalUpdated += r.updated;
    console.log(JSON.stringify({ msg: 'backfill conv', conversationId: cid, ...r }));
  }
  console.log(JSON.stringify({ msg: 'backfill done', conversations: convIds.length, totalUpdated }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(JSON.stringify({ msg: 'backfill failed', error: String(e), stack: e?.stack })); process.exit(1); });
