/**
 * P3 verification: build a PersonFingerprint for a named person and report the
 * aggregated core claims / stance map / style / lineage / coverage.
 *
 * Usage: npx tsx scripts/verify-p3-fingerprint.ts <entityCanonicalName>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { buildPersonFingerprint } from '@/lib/person/fingerprint-builder';

function log(o: Record<string, unknown>) { console.log(JSON.stringify({ ts: new Date().toISOString(), ...o })); }

async function main() {
  const name = process.argv[2];
  if (!name) { console.error('Usage: verify-p3-fingerprint.ts <entityCanonicalName>'); process.exit(1); }
  const entity = await prisma.entity.findFirst({ where: { canonicalName: name, type: 'person' }, select: { id: true } });
  if (!entity) { console.error(`No person entity '${name}'`); process.exit(1); }

  const r = await buildPersonFingerprint(entity.id);
  log({ msg: 'build result', ...r });

  const fp = await prisma.personFingerprint.findUnique({
    where: { entityId_version: { entityId: entity.id, version: r.version } },
  });
  if (!fp) { console.error('fingerprint not found'); process.exit(1); }

  const core = fp.coreClaimsJson as Array<{ text: string; recurrence: number; evidenceType: string; score: number }>;
  const style = fp.styleJson as { evidenceTypeDist: Record<string, number>; hedgeRate: number; sourceTypes: string[] };
  const stance = fp.stanceMapJson as Record<string, { count: number }>;
  const lineage = fp.lineageJson as Array<{ name: string; count: number }>;
  const coverage = fp.coverageJson as { episodeCount: number; wordCount: number; timeSpanMs: number };

  log({
    msg: 'p3 fingerprint summary',
    version: r.version,
    coreClaimsCount: core.length,
    topClaims: core.slice(0, 5).map(c => ({ text: c.text.slice(0, 70), recurrence: c.recurrence, evidence: c.evidenceType, score: c.score })),
    stanceMap: Object.fromEntries(Object.entries(stance).map(([k, v]) => [k, v.count])),
    styleEvidenceDist: style.evidenceTypeDist,
    hedgeRate: style.hedgeRate,
    sourceTypes: style.sourceTypes,
    lineageTop: lineage.slice(0, 5).map(l => ({ name: l.name, count: l.count })),
    coverage,
    verdict: core.length > 0 ? 'PASS (L3 fingerprint aggregated from own speech + claims)' : 'NEEDS REVIEW (empty)',
  });
  await prisma.$disconnect();
}
main().catch(e => { console.error(JSON.stringify({ msg: 'verify-p3 failed', error: String(e), stack: e?.stack })); process.exit(1); });
