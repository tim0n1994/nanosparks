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
import { getLlmSettings } from '@/lib/settings';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { CLUSTER_LABEL_PROMPT } from '@/lib/llm/prompts/cluster-label';
import { z } from 'zod';

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
  clusterLabel?: string;
  text: string;
  conversationId: string;
}

const clusterLabelSchema = z.object({
  labels: z.array(z.object({ clusterId: z.number(), label: z.string() })).default([]),
});

/**
 * Pure: group projected points by cluster and pick up to `sampleSize` member
 * texts per cluster (for LLM labeling). Singletons get no sample. Exported for
 * testing the grouping without an LLM.
 */
export function clusterSamples(points: ProjectedPoint[], sampleSize = 6): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const p of points) {
    if (!out.has(p.clusterId)) out.set(p.clusterId, []);
    const arr = out.get(p.clusterId)!;
    if (arr.length < sampleSize) arr.push(p.text);
  }
  return out;
}

/**
 * Pure: derive a deterministic fallback label when no LLM is available/needed
 * (singletons or labeling failure). Keeps the UI from showing a bare number.
 */
export function fallbackLabel(clusterId: number): string {
  return `主题 ${clusterId + 1}`;
}

/**
 * Atlas point cap. The JS UMAP over 1024-d vectors is CPU-bound; on the
 * ThinkPad (i5-2520M) even the nearest-neighbour phase of an uncapped 58k-point
 * corpus runs for hours. The cap keeps projection bounded; the atlas stays a
 * sampled overview of very large corpora.
 */
function projectionPointCap(): number {
  const n = parseInt(process.env.PROJECT_MAX_POINTS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 4000;
}

/** Deterministic stride sample (stable across runs for equal input). */
function stridedSample<T>(items: T[], max: number): T[] {
  const stride = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * stride)]);
  return out;
}

/**
 * Project embedding points to 2D + cluster them. Stable given equal inputs.
 *
 * Async on purpose (2026-10-19): `umap.fitAsync` yields between epochs so the
 * shared worker process keeps renewing BullMQ locks. The synchronous `fit` froze
 * the event loop past lockDuration on large corpora and stalled every queue in
 * the same process (260 project + 175 analyze stalled jobs from the Mac era).
 * Returns the points with cluster ids (-1 = noise).
 */
export async function projectPoints(
  points: EmbeddingPoint[],
  opts: { nComponents?: number; nNeighbors?: number; minPoints?: number; epsilon?: number } = {},
): Promise<ProjectedPoint[]> {
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
    coords = await umap.fitAsync(vectors);
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

  const cap = projectionPointCap();
  const sampled = points.length > cap ? stridedSample(points, cap) : points;
  if (sampled.length < points.length) {
    logger.warn('Atlas projection capped: projecting a deterministic sample', {
      corpusId,
      vectors: points.length,
      projected: sampled.length,
      cap,
      note: 'raise PROJECT_MAX_POINTS to widen the atlas on stronger hardware',
    });
  }
  const projected = await projectPoints(sampled);
  const clusters = new Set(projected.map((p) => p.clusterId)).size;

  // Name each cluster via a cheap LLM (sample member texts). Best-effort: on
  // failure or no client, fall back to "主题 N" so the atlas never shows bare ids.
  const labels = await labelClusters(projected);

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
        clusterLabel: labels.get(p.clusterId) ?? null,
      },
    });
  }

  logger.info('Corpus projected', { corpusId, points: projected.length, clusters });
  void toPrismaJson; // keep import live for consistency with sibling modules
  return { points: projected.length, clusters };
}

async function labelClusters(points: ProjectedPoint[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const samples = clusterSamples(points);
  // Only label clusters with >=2 members (singletons get the fallback).
  const labelable: number[] = [];
  for (const [cid, arr] of samples) {
    if (arr.length >= 2) {
      labelable.push(cid);
      out.set(cid, fallbackLabel(cid)); // default until LLM confirms
    } else {
      out.set(cid, fallbackLabel(cid));
    }
  }
  if (labelable.length === 0) return out;
  try {
    const settings = await getLlmSettings();
    const client = settings.apiFormat === 'anthropic'
      ? new ClaudeClient(settings.apiKey, settings.model, settings.baseUrl)
      : new OpenAIClient(settings.apiKey, settings.model, settings.baseUrl);
    const payload = labelable.map((cid) => ({ clusterId: cid, samples: samples.get(cid)! }));
    const prompt = CLUSTER_LABEL_PROMPT.replace('{{clusters}}', JSON.stringify(payload));
    const parsed = await client.completeStructured(
      [{ role: 'user', content: prompt }],
      clusterLabelSchema,
      { maxTokens: 512, schemaName: 'cluster_labels' },
    );
    for (const l of parsed.labels) {
      if (l.label?.trim()) out.set(l.clusterId, l.label.trim().slice(0, 30));
    }
  } catch (e) {
    logger.warn('Cluster labeling failed, using fallback labels', { error: String(e) });
  }
  return out;
}
