/**
 * RAG Evaluation Script (RAGAS-style)
 *
 * Evaluates retrieval pipeline quality using golden QA pairs.
 * Metrics:
 * - Faithfulness: are all claims in the answer supported by retrieved context?
 * - Context Recall: what fraction of golden-relevant context was retrieved?
 *
 * Usage:
 *   npx tsx scripts/eval-rag.ts --golden <json-file>
 *
 * Golden file format:
 * [
 *   {
 *     "question": "What did speaker A say about AI?",
 *     "expectedTuIds": ["tu_abc", "tu_def"],
 *     "language": "en"
 *   }
 * ]
 */

import { readFileSync } from 'node:fs';
import { extractCitations, verifyCitations } from '../src/lib/rag/citation-verifier';
import type { SearchResult } from '../src/lib/rag/hybrid-search';

interface GoldenQA {
  question: string;
  expectedTuIds: string[];
  language: string;
}

interface EvalResult {
  question: string;
  language: string;
  faithfulness: number;
  contextRecall: number;
  citationCount: number;
  verifiedCitations: number;
}

/**
 * Compute faithfulness: fraction of citations that are verified.
 * (Proxy for whether claims are grounded in retrieved evidence.)
 */
function computeFaithfulness(
  answer: string,
  candidates: SearchResult[],
): { faithfulness: number; verified: number; total: number } {
  const result = verifyCitations(answer, candidates);
  const total = result.citations.length;
  const verified = result.verifiedCount;

  return {
    faithfulness: total > 0 ? verified / total : 0,
    verified,
    total,
  };
}

/**
 * Compute context recall: fraction of expected TU IDs that were retrieved.
 */
function computeContextRecall(
  retrievedTuIds: string[],
  expectedTuIds: string[],
): number {
  if (expectedTuIds.length === 0) return 1;
  const retrievedSet = new Set(retrievedTuIds);
  const found = expectedTuIds.filter((id) => retrievedSet.has(id));
  return found.length / expectedTuIds.length;
}

// CLI
const args = process.argv.slice(2);
const goldenIdx = args.indexOf('--golden');

if (goldenIdx === -1 || !args[goldenIdx + 1]) {
  console.error('Usage: npx tsx scripts/eval-rag.ts --golden <golden-qa.json>');
  console.error('\nGolden file format: [{ "question": "...", "expectedTuIds": ["..."], "language": "en" }]');
  process.exit(1);
}

const goldenPath = args[goldenIdx + 1];
const golden = JSON.parse(readFileSync(goldenPath, 'utf-8')) as GoldenQA[];

console.log(`Loaded ${golden.length} golden QA pairs\n`);

// This is a framework — actual retrieval requires a running server.
// In production, this script would call the /api/corpora/:id/query endpoint
// and measure the results. For now, we output the evaluation framework.

const results: EvalResult[] = golden.map((qa) => {
  // Placeholder: in production, call the actual API
  const mockRetrieved: string[] = [];
  const mockAnswer = '';
  const mockCandidates: SearchResult[] = [];

  const faith = computeFaithfulness(mockAnswer, mockCandidates);
  const recall = computeContextRecall(mockRetrieved, qa.expectedTuIds);

  return {
    question: qa.question,
    language: qa.language,
    faithfulness: faith.faithfulness,
    contextRecall: recall,
    citationCount: faith.total,
    verifiedCitations: faith.verified,
  };
});

const avgFaithfulness = results.reduce((s, r) => s + r.faithfulness, 0) / results.length;
const avgRecall = results.reduce((s, r) => s + r.contextRecall, 0) / results.length;

console.log('--- RAG Evaluation Results ---');
console.log(`Questions:         ${results.length}`);
console.log(`Avg Faithfulness:  ${(avgFaithfulness * 100).toFixed(1)}%  (target: >90%)`);
console.log(`Avg Context Recall:${(avgRecall * 100).toFixed(1)}%  (target: >80%)`);
console.log('\nPer-question breakdown:');
for (const r of results) {
  console.log(`  [${r.language || '?'}] ${r.question.slice(0, 60)}...`);
  console.log(`       faithfulness=${(r.faithfulness * 100).toFixed(0)}%  recall=${(r.contextRecall * 100).toFixed(0)}%  citations=${r.citationCount}`);
}
