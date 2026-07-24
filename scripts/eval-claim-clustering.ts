/**
 * E5 claim 聚类质量评测（轮廓系数，PRD §7：轮廓系数 + 人工抽检）。
 *
 * 用法： npx tsx scripts/eval-claim-clustering.ts --corpus <corpusId>
 *
 * 取该 corpus 的 CanonicalClaim 成员 TU 的 embedding，按所属 claim 聚类，
 * 算整体轮廓系数（-1..1，越高簇越内聚外散）。
 */
import { prisma } from '../src/lib/prisma';
import { silhouetteScore } from '../src/lib/eval/extraction-metrics';

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--corpus');
  const corpusId = args[ci + 1];
  if (!corpusId) { console.error('Usage: eval-claim-clustering.ts --corpus <corpusId>'); process.exit(1); }

  const claims = await prisma.canonicalClaim.findMany({
    where: { corpusId },
    select: { id: true, memberTuIdsJson: true },
  });
  const tuIds = claims.flatMap((c) => Array.isArray(c.memberTuIdsJson) ? (c.memberTuIdsJson as string[]) : []);
  if (tuIds.length < 2 || claims.length < 2) {
    console.log('Not enough claims/TUs to compute silhouette (need ≥2 clusters).');
    await prisma.$disconnect();
    return;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ resource_id: string; embedding: string }>>(
    `SELECT resource_id, embedding::text AS embedding FROM embeddings
     WHERE resource_type='thought_unit' AND resource_id = ANY($1::text[])`,
    tuIds,
  );
  const vec = new Map<string, number[]>();
  for (const r of rows) {
    try { vec.set(r.resource_id, r.embedding.replace(/^\[|\]$/g, '').split(',').map(Number)); } catch { /* skip */ }
  }

  // Map each TU → its claim's index (the cluster label).
  const tuToCluster = new Map<string, number>();
  claims.forEach((c, ci2) => {
    const members = Array.isArray(c.memberTuIdsJson) ? (c.memberTuIdsJson as string[]) : [];
    for (const id of members) tuToCluster.set(id, ci2);
  });

  const vectors: number[][] = [];
  const cluster: number[] = [];
  for (const id of tuIds) {
    const v = vec.get(id);
    const c = tuToCluster.get(id);
    if (v && v.length > 0 && c !== undefined) { vectors.push(v); cluster.push(c); }
  }

  const score = silhouetteScore(vectors, cluster);
  console.log('─── Claim Clustering Eval ───');
  console.log(`corpus: ${corpusId}`);
  console.log(`claims: ${claims.length}  tUs with embeddings: ${vectors.length}`);
  console.log(`silhouette: ${score.toFixed(3)}  (range -1..1; higher = more cohesive clusters)`);
  console.log(`guidance: >0.3 reasonable, >0.5 well-separated, <0 = clusters likely wrong`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
