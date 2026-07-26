/**
 * North-star metric (PRD §10.1, architecture 2026-08 §4): hold-out prediction.
 *
 * For a person with claims in ≥2 episodes: hold out the NEWEST episode, use the
 * earlier episodes' claims as the "fingerprint corpus", and for each held-out
 * claim (topic) predict the person's stance/polarity from the most similar
 * historical claim. Compare predictions against what they actually said.
 *
 * This v1 is a deterministic LEXICAL baseline (token-overlap topic matching —
 * same matcher family as cross-person/stance-drift), deliberately LLM-free:
 * it gives a reproducible floor. An LLM predictor should beat this floor; if it
 * can't, the fingerprint carries no signal (that verdict is the point).
 *
 * Honest-reporting rules:
 *   - coverage and agreement are reported separately (never blended);
 *   - a person without ≥2 episodes is reported as "insufficient corpus", not skipped silently;
 *   - matches below MIN_SIM don't predict (no similarity → no claim to predict from).
 *
 * Usage: npx tsx scripts/northstar-holdout.ts [entityIdOrName]
 *        (no arg: evaluate every person with ≥2 claim-bearing episodes)
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';

const MIN_SIM = 0.12; // token-overlap floor below which we refuse to predict

const tokenize = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2),
  );

function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

interface ClaimRow {
  id: string;
  text: string;
  stance: string;
  polarity: number | null;
  conversationId: string | null;
  assertedAt: Date | null;
}

interface HoldoutReport {
  entityId: string;
  name: string;
  episodes: number;
  trainClaims: number;
  holdoutClaims: number;
  holdoutConversationId: string | null;
  predicted: number;
  coverage: number; // predicted / holdoutClaims
  stanceAgree: number; // among predicted
  stanceAgreement: number; // stanceAgree / predicted
  examples: Array<{ holdout: string; matched: string; sim: number; predictedStance: string; actualStance: string; hit: boolean }>;
  verdict: 'ok' | 'insufficient_corpus';
}

async function evaluateEntity(entityId: string, name: string): Promise<HoldoutReport> {
  // Claims grouped by the episode (conversation) they came from, via source TU.
  const claims = await prisma.personClaim.findMany({
    where: { entityId, supersededAt: null },
    select: { id: true, text: true, stance: true, polarity: true, sourceThoughtUnitId: true, firstAssertedAt: true },
  });
  const tuIds = claims.map((c) => c.sourceThoughtUnitId).filter(Boolean) as string[];
  const tus = tuIds.length
    ? await prisma.thoughtUnit.findMany({ where: { id: { in: tuIds } }, select: { id: true, conversationId: true } })
    : [];
  const convByTu = new Map(tus.map((t) => [t.id, t.conversationId]));

  const rows: ClaimRow[] = claims.map((c) => ({
    id: c.id,
    text: c.text,
    stance: c.stance,
    polarity: c.polarity,
    conversationId: c.sourceThoughtUnitId ? convByTu.get(c.sourceThoughtUnitId) ?? null : null,
    assertedAt: c.firstAssertedAt,
  }));

  const byConv = new Map<string, ClaimRow[]>();
  for (const r of rows) {
    if (!r.conversationId) continue;
    byConv.set(r.conversationId, [...(byConv.get(r.conversationId) ?? []), r]);
  }

  if (byConv.size < 2) {
    return {
      entityId, name, episodes: byConv.size,
      trainClaims: 0, holdoutClaims: 0, holdoutConversationId: null,
      predicted: 0, coverage: 0, stanceAgree: 0, stanceAgreement: 0,
      examples: [], verdict: 'insufficient_corpus',
    };
  }

  // Newest episode (by its claims' assertedAt) is the holdout.
  const convTimes = [...byConv.entries()].map(([cid, rs]) => ({
    cid,
    t: Math.max(...rs.map((r) => r.assertedAt?.getTime() ?? 0)),
  }));
  convTimes.sort((a, b) => b.t - a.t);
  const holdoutConv = convTimes[0].cid;
  const holdout = byConv.get(holdoutConv)!;
  const train = rows.filter((r) => r.conversationId && r.conversationId !== holdoutConv);

  let predicted = 0;
  let stanceAgree = 0;
  const examples: HoldoutReport['examples'] = [];
  for (const h of holdout) {
    let best: { row: ClaimRow; sim: number } | null = null;
    for (const t of train) {
      const s = similarity(h.text, t.text);
      if (s >= MIN_SIM && (!best || s > best.sim)) best = { row: t, sim: s };
    }
    if (!best) continue;
    predicted++;
    const hit = best.row.stance === h.stance;
    if (hit) stanceAgree++;
    if (examples.length < 5) {
      examples.push({
        holdout: h.text.slice(0, 60),
        matched: best.row.text.slice(0, 60),
        sim: Math.round(best.sim * 100) / 100,
        predictedStance: best.row.stance,
        actualStance: h.stance,
        hit,
      });
    }
  }

  return {
    entityId, name, episodes: byConv.size,
    trainClaims: train.length, holdoutClaims: holdout.length, holdoutConversationId: holdoutConv,
    predicted,
    coverage: holdout.length ? Math.round((predicted / holdout.length) * 100) / 100 : 0,
    stanceAgree,
    stanceAgreement: predicted ? Math.round((stanceAgree / predicted) * 100) / 100 : 0,
    examples,
    verdict: 'ok',
  };
}

async function main() {
  const arg = process.argv[2];
  const persons = await prisma.entity.findMany({
    where: arg
      ? { type: 'person', OR: [{ id: arg }, { canonicalName: { contains: arg } }] }
      : { type: 'person', personClaims: { some: {} } },
    select: { id: true, canonicalName: true },
  });
  const reports: HoldoutReport[] = [];
  for (const p of persons) {
    reports.push(await evaluateEntity(p.id, p.canonicalName));
  }
  // Insufficient-corpus entities are listed, not hidden — the missing corpus IS the finding.
  console.log(JSON.stringify({
    evaluated: reports.filter((r) => r.verdict === 'ok'),
    insufficientCorpus: reports.filter((r) => r.verdict === 'insufficient_corpus').map((r) => ({ name: r.name, episodes: r.episodes })),
  }, null, 1));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
