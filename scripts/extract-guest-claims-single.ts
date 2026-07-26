/**
 * 单次 LLM 调用的嘉宾 claim 抽取（绕过慢速 windowed extraction）。
 *
 * 问题：windowed extraction（57 或 6 窗口）对 glm-5.2 太慢。这里只做 1 次 LLM 调用：
 * 把嘉宾发言的关键部分（截取 12000 字）一次送给 LLM，直接产出 claims。
 * 牺牲一些覆盖度（只取前 12000 字），但换取速度（1 次调用 vs 6-57 次）。
 *
 * Usage: npx tsx scripts/extract-guest-claims-single.ts <conversationId> <participantName>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { getLlmSettings } from '@/lib/settings';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { inferStanceFromText } from '@/lib/person/claim-promoter';
import { z } from 'zod';

function log(o: Record<string, unknown>) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...o })); }

const ClaimSchema = z.array(z.object({
  text: z.string(),
  stance: z.string().optional(),
}));

const PROMPT = `分析以下一位播客嘉宾的发言，提取出他/她表达的核心观点和主张（5-15条）。
每条用一句话概括，标注立场（assert/oppose/question）。
只提取嘉宾自己的观点，不要提取引用别人的话。
输出 JSON 数组：[{"text":"...","stance":"assert"}]

嘉宾发言：
{{speech}}`;

async function main() {
  const conversationId = process.argv[2];
  const participantName = process.argv[3];
  if (!conversationId || !participantName) { console.error('Usage: extract-guest-claims-single.ts <conversationId> <participantName>'); process.exit(1); }

  const participant = await prisma.participant.findFirst({
    where: { conversationId, name: participantName },
    select: { id: true, name: true },
  });
  if (!participant) { console.error(`Participant '${participantName}' not found`); process.exit(1); }

  const turns = await prisma.turn.findMany({
    where: { conversationId, participantId: participant.id },
    orderBy: { turnIndex: 'asc' },
    select: { id: true, turnIndex: true, text: true },
  });
  // 取前 12000 字（覆盖主要观点，单次调用）
  const speech = turns.map((t) => t.text).join(' ').slice(0, 12000);
  log({ msg: 'single-shot start', participant: participant.name, turns: turns.length, speechChars: speech.length });

  const s = await getLlmSettings();
  const client = s.apiFormat === 'anthropic'
    ? new ClaudeClient(s.apiKey, s.model, s.baseUrl)
    : new OpenAIClient(s.apiKey, s.model, s.baseUrl);

  const prompt = PROMPT.replace('{{speech}}', speech);
  const response = await client.completeWithRetry([{ role: 'user', content: prompt }], 2048, 3);
  log({ msg: 'llm responded', len: response.content.length });

  // 解析
  let claims: Array<{ text: string; stance?: string }> = [];
  try {
    const cleaned = response.content.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start >= 0 && end > start) {
      claims = ClaimSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
    }
  } catch (e) {
    log({ msg: 'parse failed', error: String(e) });
  }
  log({ msg: 'claims parsed', count: claims.length });

  // 写入 TU + EvidenceSpan（participantId = 嘉宾）
  const run = await prisma.extractionRun.create({
    data: { conversationId, kind: 'extract', model: s.model, status: 'completed', finishedAt: new Date(), isActive: false },
  });

  let synced = 0;
  for (const c of claims) {
    // 找最相关的 turn 作为 evidence（简单文本匹配）
    const evidenceTurn = turns.find((t) => t.text.includes(c.text.slice(0, 20))) ?? turns[0];
    const tu = await prisma.thoughtUnit.create({
      data: {
        conversationId, type: 'claim', text: c.text, confidence: 0.8,
        extractionVersion: 'guest-single-shot', runId: run.id,
        participantId: participant.id,
        stance: c.stance || inferStanceFromText(c.text, 'claim'),
      },
    });
    if (evidenceTurn) {
      await prisma.evidenceSpan.create({
        data: { thoughtUnitId: tu.id, turnId: evidenceTurn.id, startMs: 0, endMs: 0, quote: evidenceTurn.text.slice(0, 200), confidence: 0.7 },
      });
    }
    synced++;
  }

  log({ msg: 'single-shot done', synced, runId: run.id, verdict: synced > 0 ? 'PASS' : 'NEEDS REVIEW' });
  await prisma.$disconnect();
}
main().catch((e) => { console.error(JSON.stringify({ msg: 'single-shot failed', error: String(e), stack: e?.stack })); process.exit(1); });
