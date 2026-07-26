/**
 * 针对性嘉宾 claim 抽取（修复 extraction 偏 host 的问题）。
 * 只对嘉宾的 turns 做 windowed extraction，产出的 TU 直接归属给嘉宾。
 * Usage: npx tsx scripts/extract-guest-claims.ts <conversationId> <participantName>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { createWindows, extractFromWindow, mergeExtractions } from '@/lib/extraction/windowed-extraction';
import { getLlmSettings } from '@/lib/settings';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { inferStanceFromText } from '@/lib/person/claim-promoter';

function log(o: Record<string, unknown>) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...o })); }

async function main() {
  const conversationId = process.argv[2];
  const participantName = process.argv[3];
  if (!conversationId || !participantName) { console.error('Usage: extract-guest-claims.ts <conversationId> <participantName>'); process.exit(1); }

  const participant = await prisma.participant.findFirst({
    where: { conversationId, name: participantName },
    select: { id: true, name: true, role: true },
  });
  if (!participant) { console.error(`Participant '${participantName}' not found`); process.exit(1); }
  log({ msg: 'guest extraction start', conversationId, participant: participant.name, role: participant.role });

  const turns = await prisma.turn.findMany({
    where: { conversationId, participantId: participant.id },
    orderBy: { turnIndex: 'asc' },
    select: { id: true, turnIndex: true, startMs: true, endMs: true, text: true },
  });
  log({ msg: 'guest turns', count: turns.length, chars: turns.reduce((n, t) => n + t.text.length, 0) });

  const turnLikes = turns.map((t) => ({
    turnIndex: t.turnIndex, startMs: t.startMs, endMs: t.endMs, text: t.text, speakerLabel: participant.name,
  }));
  const windows = createWindows(turnLikes);
  log({ msg: 'windows created', count: windows.length });

  const s = await getLlmSettings();
  const client = s.apiFormat === 'anthropic'
    ? new ClaudeClient(s.apiKey, s.model, s.baseUrl)
    : new OpenAIClient(s.apiKey, s.model, s.baseUrl);

  const results = [];
  for (const w of windows) {
    try {
      const r = await extractFromWindow(client, w);
      results.push(r);
      log({ msg: 'window extracted', index: w.index, tus: r.thoughtUnits?.length ?? 0 });
    } catch (e) {
      log({ msg: 'window failed', index: w.index, error: String(e) });
    }
  }

  const merged = mergeExtractions(results);
  log({ msg: 'merged', tus: merged.thoughtUnits.length });

  const run = await prisma.extractionRun.create({
    data: { conversationId, kind: 'extract', model: s.model, status: 'completed', finishedAt: new Date(), isActive: false },
  });

  let synced = 0;
  for (const tu of merged.thoughtUnits) {
    const created = await prisma.thoughtUnit.create({
      data: {
        conversationId, type: tu.type, text: tu.text, confidence: tu.confidence,
        extractionVersion: 'guest-targeted', runId: run.id,
        participantId: participant.id,
        stance: inferStanceFromText(tu.text, tu.type),
      },
    });
    for (const es of tu.evidenceSpans) {
      const turn = es.turnIndex !== undefined
        ? turns.find((t) => t.turnIndex === es.turnIndex)
        : turns.find((t) => Math.abs(t.startMs - es.startMs) < 10000);
      await prisma.evidenceSpan.create({
        data: { thoughtUnitId: created.id, turnId: turn?.id ?? null, startMs: es.startMs, endMs: es.endMs, quote: es.quote.slice(0, 200), confidence: tu.confidence },
      });
    }
    synced++;
  }

  log({ msg: 'guest extraction done', synced, runId: run.id, verdict: synced > 0 ? 'PASS' : 'NEEDS REVIEW' });
  await prisma.$disconnect();
}
main().catch((e) => { console.error(JSON.stringify({ msg: 'extract-guest failed', error: String(e), stack: e?.stack })); process.exit(1); });
