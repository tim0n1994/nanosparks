/**
 * P-1 verification harness (not a unit test — a live DB integration check).
 *
 * Proves the S1+S2 fix against a REAL conversation: the normalize_turns job now
 * reads the DiarizationSegment table and writes Turn.participantId from it.
 *
 * Because historical audio has been retention-cleaned and pyannote is not always
 * installed, this harness can synthesize diarization segments from the existing
 * turn timeline (deterministic, alternating speakers by time block) when none
 * exist. That verifies the JOB LOGIC (table read -> overlap attribution -> in-place
 * participantId update), NOT diarization quality. True quality needs a real
 * pyannote run on audio (fresh ingest, or audio re-acquisition for backfill).
 *
 * Usage:
 *   npx tsx scripts/verify-p1-attribution.ts <conversationId>            # use existing segments
 *   npx tsx scripts/verify-p1-attribution.ts <conversationId> --synth     # synthesize if absent
 *   npx tsx scripts/verify-p1-attribution.ts --auto                       # pick the worst null conversation
 */
import { config as loadEnv } from 'dotenv';
loadEnv();

import { prisma } from '@/lib/prisma';
import { processNormalizeTurnsJob } from '@/lib/queue/jobs/normalize-turns';

function log(obj: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

async function nullRate(conversationId: string) {
  const row = await prisma.turn.aggregate({
    _count: { _all: true },
    where: { conversationId },
  });
  const nulls = await prisma.turn.count({
    where: { conversationId, participantId: null },
  });
  const total = row._count._all;
  return { total, nulls, rate: total === 0 ? 0 : nulls / total };
}

async function pickWorst() {
  const convs = await prisma.conversation.findMany({
    where: { status: { in: ['completed', 'transcribed'] } },
    select: {
      id: true,
      title: true,
      _count: { select: { turns: true } },
      turns: { where: { participantId: null }, select: { id: true } },
    },
  });
  // prefer a mid-size conversation (faster than the 7-hour one, more signal than 4-turn ones)
  const candidates = convs
    .filter((c) => c.turns.length >= 50 && c.turns.length <= 600)
    .sort((a, b) => b.turns.length - a.turns.length);
  return candidates[0]?.id ?? convs[0]?.id;
}

async function synthesizeSegments(conversationId: string) {
  // Build a plausible 2-speaker timeline from turn timestamps: walk turns in
  // order, switching speaker every ~6 turns so each block is one speaker. This
  // is deterministic and exercises the overlap attribution path end to end.
  const turns = await prisma.turn.findMany({
    where: { conversationId },
    orderBy: { turnIndex: 'asc' },
    select: { startMs: true, endMs: true, turnIndex: true },
  });
  if (turns.length === 0) return 0;
  await prisma.diarizationSegment.deleteMany({ where: { conversationId } });
  const segs: { label: string; startMs: number; endMs: number }[] = [];
  let i = 0;
  while (i < turns.length) {
    const label = `SPEAKER_${(Math.floor(i / 6) % 2).toString().padStart(2, '0')}`;
    const block = turns.slice(i, i + 6);
    segs.push({
      label,
      startMs: block[0].startMs,
      endMs: block[block.length - 1].endMs,
    });
    i += 6;
  }
  await prisma.diarizationSegment.createMany({
    data: segs.map((s) => ({ conversationId, ...s })),
  });
  return segs.length;
}

async function main() {
  const args = process.argv.slice(2);
  const synth = args.includes('--synth');
  let conversationId = args.find((a) => !a.startsWith('--'));
  if (!conversationId || conversationId === '--auto') {
    conversationId = await pickWorst();
  }
  if (!conversationId) {
    console.error('No conversation found to verify.');
    process.exit(1);
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, title: true },
  });
  log({ msg: 'verify-p1 start', conversationId, title: (conv?.title || '').slice(0, 50) });

  const before = await nullRate(conversationId);
  log({ msg: 'before', ...before, nullRatePct: (before.rate * 100).toFixed(2) });

  const haveSegs = await prisma.diarizationSegment.count({ where: { conversationId } });
  if (haveSegs === 0 && synth) {
    const n = await synthesizeSegments(conversationId);
    log({ msg: 'synthesized diarization segments', segments: n });
  } else if (haveSegs === 0) {
    log({ msg: 'no DiarizationSegment rows; pass --synth to generate from turn timeline', segments: 0 });
    await prisma.$disconnect();
    return;
  }

  // Run the real job processor in-process.
  await processNormalizeTurnsJob({ conversationId });

  const after = await nullRate(conversationId);
  log({ msg: 'after', ...after, nullRatePct: (after.rate * 100).toFixed(2) });

  const segCount = await prisma.diarizationSegment.count({ where: { conversationId } });
  const speakers = await prisma.participant.count({ where: { conversationId } });
  log({
    msg: 'verify-p1 result',
    conversationId,
    segments: segCount,
    speakers,
    beforeNullPct: (before.rate * 100).toFixed(2),
    afterNullPct: (after.rate * 100).toFixed(2),
    verdict: after.rate <= 0.05 ? 'PASS (L1 attribution >=95%)' : 'NEEDS REVIEW',
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ level: 'ERROR', msg: 'verify-p1 failed', error: String(e), stack: e?.stack }));
  process.exit(1);
});
