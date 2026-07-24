/**
 * E5 归属准确率评测（PRD §7：TU→participant 抽检，目标 ≥0.9）。
 *
 * 用法： npx tsx scripts/eval-attribution.ts --corpus <corpusId> --sample <n=50>
 *
 * 对该 corpus 的 ThoughtUnit，以「同时间窗 Turn 的 participantId」作为 gold
 * （best-effort 近似——真正的 gold 需人工抽检，这里给可复跑的基线），
 * 与系统写入的 tu.participantId 比对算准确率。
 */
import { prisma } from '../src/lib/prisma';
import { attributionAccuracy, type AttributionSample } from '../src/lib/eval/extraction-metrics';

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--corpus');
  const si = args.indexOf('--sample');
  const corpusId = args[ci + 1];
  const sampleN = si >= 0 ? parseInt(args[si + 1], 10) : 50;
  if (!corpusId) { console.error('Usage: eval-attribution.ts --corpus <corpusId> [--sample <n>]'); process.exit(1); }

  const tus = await prisma.thoughtUnit.findMany({
    where: { conversation: { corpusId } },
    select: {
      id: true, participantId: true, conversationId: true,
      evidenceSpans: { select: { turnId: true, startMs: true }, take: 1 },
    },
    take: sampleN,
  });
  if (tus.length === 0) {
    console.log('No thought units found for corpus.');
    await prisma.$disconnect();
    return;
  }

  // Preload turns per conversation for the gold (nearest-by-time) lookup.
  const convIds = [...new Set(tus.map((t) => t.conversationId))];
  const turns = await prisma.turn.findMany({
    where: { conversationId: { in: convIds } },
    select: { id: true, conversationId: true, participantId: true, startMs: true },
  });
  const turnsByConv = new Map<string, typeof turns>();
  for (const t of turns) {
    if (!turnsByConv.has(t.conversationId)) turnsByConv.set(t.conversationId, []);
    turnsByConv.get(t.conversationId)!.push(t);
  }

  const samples: AttributionSample[] = [];
  for (const tu of tus) {
    const es = tu.evidenceSpans[0];
    let gold: string | null = null;
    if (es?.turnId) {
      gold = turns.find((t) => t.id === es.turnId)?.participantId ?? null;
    } else if (es) {
      // nearest turn by startMs
      const convTurns = turnsByConv.get(tu.conversationId) ?? [];
      let best: typeof turns[number] | undefined;
      let bestDelta = Infinity;
      for (const t of convTurns) { const d = Math.abs(t.startMs - es.startMs); if (d < bestDelta) { bestDelta = d; best = t; } }
      gold = best?.participantId ?? null;
    }
    samples.push({ goldParticipantId: gold, predictedParticipantId: tu.participantId ?? null });
  }

  const r = attributionAccuracy(samples);
  console.log('─── Attribution Accuracy Eval ───');
  console.log(`corpus: ${corpusId}  samples: ${r.total}`);
  console.log(`accuracy: ${r.accuracy.toFixed(3)}  (correct ${r.correct}/${r.total})`);
  console.log(`gate (≥ 0.90): ${r.accuracy >= 0.9 ? 'PASS' : 'FAIL'}`);
  console.log('note: gold = nearest-turn participantId (best-effort); for a release gate, replace with human labels.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
