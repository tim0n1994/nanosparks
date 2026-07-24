/**
 * E5 实体消解评测（PRD §7 闸门：precision ≥0.9）。
 *
 * 用法： npx tsx scripts/eval-entity-resolution.ts --pairs scripts/eval-data/golden-entity-pairs.json --workspace <wsId>
 *
 * 对每对 golden 候选：用 resolveEntity 分别解析 A 和 B，判定系统是否将它们
 * merge 到同一 Entity（即 resolved.id 相同），再与 gold label 算 P/R/F1。
 * 无 --workspace 时用第一个 workspace（本地评测）。
 */
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { resolveEntity } from '../src/lib/entity/resolver';
import { entityResolutionMetrics, type EntityPair } from '../src/lib/eval/extraction-metrics';
import { getLlmSettings } from '../src/lib/settings';
import { OpenAIClient, ClaudeClient } from '../src/lib/llm/client';

interface GoldenPair { candidateA: string; candidateB: string; type: string; same: boolean; }

async function main() {
  const args = process.argv.slice(2);
  const pairsIdx = args.indexOf('--pairs');
  const wsIdx = args.indexOf('--workspace');
  const pairsFile = pairsIdx >= 0 ? args[pairsIdx + 1] : 'scripts/eval-data/golden-entity-pairs.json';
  const explicitWs = wsIdx >= 0 ? args[wsIdx + 1] : undefined;

  const golden = JSON.parse(readFileSync(pairsFile, 'utf8')) as GoldenPair[];
  const ws = explicitWs ?? (await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } }))?.id;
  if (!ws) { console.error('No workspace found; pass --workspace <id>'); process.exit(1); }

  const settings = await getLlmSettings();
  const client = settings.apiFormat === 'anthropic'
    ? new ClaudeClient(settings.apiKey, settings.model, settings.baseUrl)
    : new OpenAIClient(settings.apiKey, settings.model, settings.baseUrl);

  const pairs: EntityPair[] = [];
  for (const g of golden) {
    const a = await resolveEntity(ws, { surfaceForm: g.candidateA, type: g.type, canonicalGuess: g.candidateA }, { client });
    const b = await resolveEntity(ws, { surfaceForm: g.candidateB, type: g.type, canonicalGuess: g.candidateB }, { client });
    pairs.push({ same: g.same, merged: a.entityId === b.entityId });
    console.log(`${g.same ? '[same]' : '[diff ]'} ${g.candidateA} ↔ ${g.candidateB} → ${a.entityId === b.entityId ? 'MERGED' : 'split'}  (a=${a.method} b=${b.method})`);
  }

  const m = entityResolutionMetrics(pairs);
  console.log('\n─── Entity Resolution Eval ───');
  console.log(`samples: ${pairs.length}`);
  console.log(`precision: ${m.precision.toFixed(3)}  recall: ${m.recall.toFixed(3)}  f1: ${m.f1.toFixed(3)}`);
  console.log(`TP=${m.tp}  FP=${m.fp}  FN=${m.fn}`);
  console.log(`gate (precision ≥ 0.90): ${m.precision >= 0.9 ? 'PASS' : 'FAIL'}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
