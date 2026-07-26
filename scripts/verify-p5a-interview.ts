/**
 * P5a verification: run a simulated interview with Marc Andreessen as the
 * interviewee (using a stub answerer that mimics varied answer quality) and
 * report the arc + follow-up triggering + AI-marking.
 *
 * Usage: npx tsx scripts/verify-p5a-interview.ts <entityId> [minutes]
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { runInterview } from '@/lib/interview/session';

function log(o: Record<string, unknown>) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...o })); }

async function main() {
  const entityId = process.argv[2] ?? 'cms0wwhvl0004tvyftlpqmntx';
  const minutes = parseInt(process.argv[3] ?? '15', 10);

  // Stub answerer that cycles through answer qualities to exercise the follow-up engine.
  const qualities = [
    '挺多的，不少人都这么觉得。', // vague → follow-up
    '大概 5000 人。', // now has a number → pass
    '我觉得这不行。', // short conclusion → dodge/conclusion follow-up
    '因为数据表明转化率下降了 30%，这是个系统性问题，不是个例。', // grounded → pass
    '', // empty → dodge follow-up
    'No, I do not think open source works for this project anymore, despite what I said before.', // contradiction
  ];
  let qi = 0;
  const answerer = async () => qualities[qi++ % qualities.length];

  const result = await runInterview({
    intervieweeEntityId: entityId,
    totalMinutes: minutes,
    answerer,
    hostStyle: { transitionPhrase: '那', followupDepthP75: 3 },
  });

  log({
    msg: 'p5a interview result',
    entityId,
    topics: result.arc.topics.length,
    topicLabels: result.arc.topics.map(t => t.label.slice(0, 30)),
    totalTurns: result.turns.length,
    followupsTriggered: result.followupsTriggered,
    guestTurns: result.reingestableGuestTurns,
    allHostTurnsMarkedAI: result.turns.filter(t => t.role === 'host').every(t => t.aiGenerated),
    noGuestTurnMarkedAI: result.turns.filter(t => t.role === 'guest').every(t => !t.aiGenerated),
    reasonsHit: [...new Set(result.turns.map(t => t.followupReason).filter(Boolean))],
    verdict: result.followupsTriggered > 0 && result.turns.filter(t=>t.role==='host').every(t=>t.aiGenerated)
      ? 'PASS (arc + follow-ups + AI-marking)' : 'NEEDS REVIEW',
  });

  // Print a short readable excerpt.
  console.log('\n--- transcript excerpt (first 8 turns) ---');
  for (const t of result.turns.slice(0, 8)) {
    const tag = t.role === 'host' ? (t.aiGenerated ? '[HOST·AI]' : '[HOST]') : '[GUEST]';
    const fu = t.followupReason ? ` <followup:${t.followupReason}>` : '';
    console.log(`${tag}${fu} ${t.text.slice(0, 90)}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(JSON.stringify({ msg: 'verify-p5a failed', error: String(e), stack: e?.stack })); process.exit(1); });
