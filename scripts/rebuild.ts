/**
 * rebuild — the ONLY rebuild entrypoint for derived person data
 * (architecture 2026-08 §2). Supersedes the hand-cranked repair scripts
 * (repromote-all-claims / reattribute-tus): staleness is DETECTED, then the
 * existing stage functions are re-run in dependency order.
 *
 * Staleness signals (per person entity):
 *   dangling   — active PersonClaim whose sourceThoughtUnitId no longer exists
 *                (extraction rerun deleted the TU; claim provenance is gone)
 *   unattributedTus — TUs with participantId null whose evidence turn IS attributed
 *                (claim promotion would silently miss them)
 *   staleClaims — attributed TUs newer than the entity's newest claim sync
 *   staleFingerprint — latest fingerprint older than the newest claim change
 *
 * Usage:
 *   npx tsx scripts/rebuild.ts           # report only (read-only)
 *   npx tsx scripts/rebuild.ts --fix     # re-run stale stages in dependency order
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { attributeThoughtUnitsViaEvidence } from '@/lib/person/distillation-pipeline';
import { promotePersonClaims } from '@/lib/person/claim-promoter';
import { buildPersonFingerprint } from '@/lib/person/fingerprint-builder';
import { buildHostFingerprint } from '@/lib/person/host-fingerprint';

interface EntityStaleness {
  entityId: string;
  name: string;
  dangling: number;
  staleClaims: boolean;
  staleFingerprint: boolean;
}

async function detectUnattributedTus(): Promise<Map<string, number>> {
  // TU has no participant but its first evidence turn does → attributable.
  const rows = await prisma.thoughtUnit.findMany({
    where: {
      participantId: null,
      evidenceSpans: { some: { turn: { participantId: { not: null } } } },
    },
    select: { conversationId: true },
  });
  const byConversation = new Map<string, number>();
  for (const r of rows) {
    byConversation.set(r.conversationId, (byConversation.get(r.conversationId) ?? 0) + 1);
  }
  return byConversation;
}

async function detectEntityStaleness(): Promise<EntityStaleness[]> {
  const entities = await prisma.entity.findMany({
    where: { type: 'person', speakerIdentities: { some: {} } },
    select: { id: true, canonicalName: true },
  });
  const out: EntityStaleness[] = [];
  for (const e of entities) {
    const activeClaims = await prisma.personClaim.findMany({
      where: { entityId: e.id, supersededAt: null },
      select: { sourceThoughtUnitId: true, createdAt: true },
    });
    const srcIds = activeClaims.map((c) => c.sourceThoughtUnitId).filter(Boolean) as string[];
    const liveTus = srcIds.length
      ? await prisma.thoughtUnit.findMany({ where: { id: { in: srcIds } }, select: { id: true } })
      : [];
    const dangling = srcIds.length - liveTus.length;

    const newestClaimAt = activeClaims.reduce((m, c) => Math.max(m, c.createdAt.getTime()), 0);
    const newestTu = await prisma.thoughtUnit.findFirst({
      where: { participant: { speakerIdentities: { some: { entityId: e.id } } } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const staleClaims = !!newestTu && newestTu.createdAt.getTime() > newestClaimAt;

    const latestFp = await prisma.personFingerprint.findFirst({
      where: { entityId: e.id },
      orderBy: { version: 'desc' },
      select: { builtAt: true },
    });
    const staleFingerprint =
      newestClaimAt > 0 && (!latestFp || latestFp.builtAt.getTime() < newestClaimAt);

    if (dangling > 0 || staleClaims || staleFingerprint) {
      out.push({ entityId: e.id, name: e.canonicalName, dangling, staleClaims, staleFingerprint });
    }
  }
  return out;
}

async function main() {
  const fix = process.argv.includes('--fix');

  const unattributed = await detectUnattributedTus();
  if (fix) {
    for (const [conversationId, n] of unattributed) {
      const remapped = await attributeThoughtUnitsViaEvidence(conversationId);
      console.log(JSON.stringify({ stage: 'tu-attribution', conversationId, attributable: n, remapped }));
    }
  }

  const stale = await detectEntityStaleness();
  console.log(JSON.stringify({
    unattributedTuConversations: [...unattributed.entries()].map(([id, n]) => ({ id, n })),
    staleEntities: stale,
    mode: fix ? 'fix' : 'report-only',
  }, null, 1));

  if (fix) {
    for (const s of stale) {
      const claims = await promotePersonClaims(s.entityId);
      const fp = await buildPersonFingerprint(s.entityId);
      const hostFp = await buildHostFingerprint(s.entityId).catch(() => null);
      console.log(JSON.stringify({
        stage: 'rebuild', entity: s.name,
        claims: { created: claims.created, updated: claims.updated, retired: claims.retired },
        fingerprintVersion: (fp as { version?: number } | null)?.version ?? null,
        hostFingerprint: hostFp !== null,
      }));
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ msg: 'rebuild failed', error: String(e) }));
  process.exit(1);
});
