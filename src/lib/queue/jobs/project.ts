/**
 * Project Job (V2/T-V2-8) — semantic atlas projection worker.
 *
 * Runs UMAP + DBSCAN over a corpus's thought-unit embeddings and persists
 * EmbeddingProjection rows (the semantic star map). Decoupled from the analyze
 * pipeline so a large corpus re-projection never blocks an episode import.
 * Idempotent per corpus (replace-on-write).
 */

import { projectCorpus } from '@/lib/embeddings/projection';
import { logger } from '@/lib/logger';

export interface ProjectJobData {
  corpusId: string;
}

export async function processProjectJob(data: ProjectJobData): Promise<void> {
  const { corpusId } = data;
  if (!corpusId) throw new Error('project job requires corpusId');
  logger.info('Project job started', { corpusId });
  const result = await projectCorpus(corpusId);
  logger.info('Project job done', { corpusId, points: result.points, clusters: result.clusters });
}
