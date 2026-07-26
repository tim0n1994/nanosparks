/**
 * P2 verification: attribute ThoughtUnits to their speaker (via EvidenceSpan->Turn),
 * then promote PersonClaims for a named person and report the dual-temporal result.
 *
 * ThoughtUnit.participantId is often null because extraction doesn't attribute;
 * here we backfill it from the EvidenceSpan's turn's participantId, then promote.
 *
 * Usage: npx tsx scripts/verify-p2-claims.ts <conversationId> <entityCanonicalName>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { promotePersonClaims } from '@/lib/person/claim-promoter';

function log(o: Record<string, unknown>) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...o })); }

async function main() {
  const conversationId = process.argv[2];
  const entityName = process.argv[3];
  if (!conversationId || !entityName) { console.error('Usage: verify-p2-claims.ts <conversationId> <entityName>'); process.exit(1); }

  // 1. Backfill ThoughtUnit.participantId from EvidenceSpan turn attribution.
  const tus = await prisma.thoughtUnit.findMany({
    where: { conversationId },
    select: { id: true, participantId: true, evidenceSpans: { select: { turn: { select: { participantId: true } } }, take: 1 } },
  });
  let tuRemapped = 0;
  for (const tu of tus) {
    if (tu.participantId) continue;
    const turnPart = tu.evidenceSpans[0]?.turn?.participantId;
    if (turnPart) {
      await prisma.thoughtUnit.update({ where: { id: tu.id }, data: { participantId: turnPart } });
      tuRemapped++;
    }
  }
  log({ msg: 'TU participantId backfilled', conversationId, tus: tus.length, remapped: tuRemapped });

  // 2. Find the entity.
  const entity = await prisma.entity.findFirst({ where: { canonicalName: entityName, type: 'person' }, select: { id: true } });
  if (!entity) { console.error(`No person entity '${entityName}'`); process.exit(1); }

  // 3. Promote PersonClaims.
  const r = await promotePersonClaims(entity.id);
  log({ msg: 'promote result', ...r });

  const claims = await prisma.personClaim.findMany({
    where: { entityId: entity.id },
    select: { text: true, stance: true, modality: true, evidenceType: true, firstAssertedAt: true, lastAssertedAt: true, sourceThoughtUnitId: true },
    take: 5,
  });
  log({ msg: 'sample claims', count: claims.length, claims: claims.map(c => ({ text: c.text.slice(0,80), stance: c.stance, modality: c.modality, first: c.firstAssertedAt, last: c.lastAssertedAt })) });

  // 4. Verify evidence traceability: each claim's source TU has an EvidenceSpan -> Turn.
  const srcIds = claims.map(c => c.sourceThoughtUnitId).filter(Boolean) as string[];
  let traced = 0;
  if (srcIds.length) {
    const spans = await prisma.evidenceSpan.findMany({ where: { thoughtUnitId: { in: srcIds } }, select: { id: true, turnId: true, startMs: true, endMs: true, quote: true } });
    traced = spans.filter(s => s.turnId).length;
  }
  log({ msg: 'p2 verdict', promoted: r.promoted, evidenceTraced: traced, verdict: r.promoted > 0 ? 'PASS (claims attributed + dual-temporal + evidence-linked)' : 'NEEDS REVIEW (no claims)' });
  await prisma.$disconnect();
}
main().catch(e => { console.error(JSON.stringify({ msg: 'verify-p2 failed', error: String(e), stack: e?.stack })); process.exit(1); });
