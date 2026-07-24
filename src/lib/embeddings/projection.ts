/**
 * V2/T-V2-8: semantic star-map projection.
 *
 * Takes a corpus's thought-unit embeddings and reduces them to 2D (UMAP) +
 * density clusters (DBSCAN), writes EmbeddingProjection rows. Computed in a
 * worker (zero frontend cost); the frontend just reads the atlas points.
 *
 * The pure projection→points reduction is split out (projectPoints) so it can be
 * unit-tested without a DB.
 */

import { prisma } from '@/lib/prisma';
import { toPrismaJson } from '@/lib/prisma-json';
import { logger } from '@/lib/logger';
import { DBSCAN } from 'density-clustering';
import { UMAP } from 'umap-js';
import { cosineDistance } from '@/lib/graph/canonical-claim';

export interface EmbeddingPoint {
  embeddingId: string;
  vector: number[];
  text: string;
  conversationId: string;
}

export interface ProjectedPoint {
  embeddingId: string;
  x: number;
  y: number;
  clusterId: number;
  text: string;
  conversationId: string;
}

/**
 * Pure: project embedding points to 2D + cluster them.
 * Returns the points with cluster ids (-1 = noise). Stable given equal inputs.
 */
export function projectPoints(
  points: EmbeddingPoint[],
  opts: { nComponents?: number; nNeighbors?: number; minPoints?: number; epsilon?: number } = {},
): ProjectedPoint[] {
  if (points.length === 0) return [];

  const vectors = points.map((p) => p.vector);

  // UMAP 2D reduction. Requires >= nNeighbors+1 points; for tiny corpora we
  // fall back to a trivial 2D layout so the atlas still renders something.
  let coords: number[][];
  if (vectors.length < 3) {
    coords = vectors.map((_, i) => [i, 0]);
  } else {
    const nNeighbors = Math.min(opts.nNeighbors ?? 8, Math.max(2, vectors.length - 1));
    const umap = new UMAP({ nComponents: opts.nComponents ?? 2, nNeighbors, nEpochs: 200, distanceFn: cosineDistance });
    coords = umap.fit(vectors);
  }

  // DBSCAN cluster on the 2D coords (cheap, interpretable clusters).
  const epsilon = opts.epsilon ?? 0.12;
  const minPoints = opts.minPoints ?? 2;
  const dbscan = new DBSCAN();
  const groups = dbscan.run(coords, epsilon, minPoints, (a: number[], b: number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]),
  );

  const pointCluster = new Array(points.length).fill(-1);
  groups.forEach((group, clusterId) => {
    for (const idx of group) pointCluster[idx] = clusterId;
  });
  // Promote noise points to their own singleton clusters so every point still shows.
  let nextCluster = groups.length;
  for (let i = 0; i < pointCluster.length; i++) {
    if (pointCluster[i] === -1) pointCluster[i] = nextCluster++;
  }

  return points.map((p, i) => ({
    embeddingId: p.embeddingId,
    x: coords[i][0],
    y: coords[i][1],
    clusterId: pointCluster[i],
    text: p.text,
    conversationId: p.conversationId,
  }));
}

/**
 * DB-backed: load a corpus's thought-unit embeddings + text, project, and
 * persist EmbeddingProjection rows (replace-on-write → idempotent per corpus).
 */
export async function projectCorpus(corpusId: string): Promise<{ points: number; clusters: number }> {
  const tus = await prisma.thoughtUnit.findMany({
    where: { conversation: { corpusId } },
    select: { id: true, text: true, conversationId: true },
  });
  if (tus.length === 0) {
    await prisma.embeddingProjection.deleteMany({ where: { corpusId } }).catch(() => {});
    return { points: 0, clusters: 0 };
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ resource_id: string; embedding: string }>>(
    `SELECT resource_id, embedding::text AS embedding FROM embeddings
     WHERE resource_type = 'thought_unit' AND resource_id = ANY($1::text[])`,
    tus.map((t) => t.id),
  );
  const vecById = new Map<string, number[]>();
  for (const r of rows) {
    try {
      vecById.set(r.resource_id, r.embedding.replace(/^\[|\]$/g, '').split(',').map(Number));
    } catch {
      /* skip */
    }
  }

  const points: EmbeddingPoint[] = tus
    .filter((t) => vecById.has(t.id) && (vecById.get(t.id)?.length ?? 0) > 0)
    .map((t) => ({ embeddingId: t.id, vector: vecById.get(t.id)!, text: t.text, conversationId: t.conversationId }));

  if (points.length === 0) {
    await prisma.embeddingProjection.deleteMany({ where: { corpusId } }).catch(() => {});
    return { points: 0, clusters: 0 };
  }

  const projected = projectPoints(points);
  const clusters = new Set(projected.map((p) => p.clusterId)).size;

  // Idempotent replace.
  await prisma.embeddingProjection.deleteMany({ where: { corpusId } }).catch(() => {});
  for (const p of projected) {
    await prisma.embeddingProjection.create({
      data: {
        corpusId,
        embeddingId: p.embeddingId,
        x: p.x,
        y: p.y,
        clusterId: p.clusterId,
      },
    });
  }

  logger.info('Corpus projected', { corpusId, points: projected.length, clusters });
  void toPrismaJson; // keep import live for consistency with sibling modules
  return { points: projected.length, clusters };
}
