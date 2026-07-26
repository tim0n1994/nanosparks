/**
 * 诚实化数据修正（一次性，事务内，原地更新，不删不建）：
 *
 * ① Turn：老版 backfill-attribution-method.ts 谎标的行改回真实出处。
 *    判定规则：method='dialogue' 且 confidence=0.9 且所在会话没有任何
 *    DiarizationSegment —— live 路径的 'dialogue' 只可能写在有分段的会话里
 *    （normalize job 在分段为空时早退），所以这些行必然是回填。
 *    → attributionMethod='backfill'，attributionConfidence=NULL。
 *    此后质量门的置信中位数不再给自己写的常量打分（distillation-pipeline 已排除）。
 *
 * ② PersonClaim.stance：旧 /不|错|.../ 正则推断出的立场按收紧后的
 *    inferStanceFromText 重推，原地 UPDATE（保留主键，指纹引文不产生死链）。
 *    仅处理「当前值 == 旧正则输出」的行；与旧正则不符的（LLM 直接给的）不动。
 *
 * Usage: npx tsx scripts/fix-attribution-provenance.ts
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { inferStanceFromText } from '@/lib/person/claim-promoter';

/** claim-promoter.ts 修正前的旧正则，仅用于识别「值可归因于旧正则」的行。 */
function oldInferStance(text: string): string {
  const t = text.trim();
  if (!t) return 'neutral';
  const low = t.toLowerCase();
  if (/[?？]\s*$/.test(t) || /^(what|why|how|是否|能不能|会不会|是不是)/i.test(t)) return 'question';
  if (/\b(not|never|wrong|disagree|against|should not)\b|不|错|反对|不应该|未必|不一定/.test(low)) {
    if (/not sure|不确定|说不准/.test(low)) return 'assert';
    return 'oppose';
  }
  if (/i used to|previously|曾经|以前.*现在|虽然.*但是|admit|承认/.test(low)) return 'concede';
  return 'assert';
}

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.turn.groupBy({
      by: ['attributionMethod'],
      where: { participantId: { not: null } },
      _count: true,
    });

    const relabelled = await tx.$executeRaw`
      UPDATE "Turn" t SET "attributionMethod"='backfill', "attributionConfidence"=NULL
      WHERE t."attributionMethod"='dialogue' AND t."attributionConfidence"=0.9
        AND NOT EXISTS (SELECT 1 FROM "DiarizationSegment" ds WHERE ds."conversationId"=t."conversationId")`;

    const claims = await tx.personClaim.findMany({ select: { id: true, text: true, stance: true } });
    let restanced = 0;
    let llmKept = 0;
    for (const c of claims) {
      if (c.stance === oldInferStance(c.text)) {
        const next = inferStanceFromText(c.text, 'claim');
        if (next !== c.stance) {
          await tx.personClaim.update({ where: { id: c.id }, data: { stance: next } });
          restanced++;
        }
      } else {
        llmKept++;
      }
    }

    const after = await tx.turn.groupBy({
      by: ['attributionMethod'],
      where: { participantId: { not: null } },
      _count: true,
    });
    const stanceDist = await tx.personClaim.groupBy({ by: ['stance'], _count: true });
    return { before, relabelled, claimsTotal: claims.length, restanced, llmKept, after, stanceDist };
  }, { timeout: 120_000 });

  console.log(JSON.stringify(result, null, 1));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ msg: 'fix failed (rolled back)', error: String(e) }));
  process.exit(1);
});
