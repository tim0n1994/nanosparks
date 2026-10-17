/**
 * LLM correction pass (A2) — runs between normalize_turns and extract.
 *
 * Per PRD §A2 "LLM 后处理 pass": terminology-dictionary correction + filler-word
 * compression + mixed Chinese/English formatting normalization. Uses a DeepSeek-
 * class model, ~¥0.1/episode. Cost is recorded on the ExtractionRun.costUsd.
 *
 * The pass is deliberately conservative: it must NOT change meaning or timestamps.
 * It only rewrites the *text* of each turn. Input/output are arrays of turn texts
 * keyed by turnIndex so the caller can persist corrected text without touching
 * startMs/endMs/words/translationJson.
 */

import type { OpenAIClient } from '@/lib/llm/client';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { logger } from '@/lib/logger';

export interface CorrectionInput {
  turnIndex: number;
  speakerLabel: string | null;
  text: string;
}

export interface CorrectionOutput {
  turnIndex: number;
  text: string;
  /** Number of terms/glossary hits applied (for observability). */
  corrections: number;
}

export interface CorrectionGlossary {
  /** wrong -> right term substitutions (case-insensitive whole-token match). */
  terms?: Record<string, string>;
  /** Known entities (people, companies, products) extracted from podcast metadata. */
  entities?: string[];
}

/** Podcast metadata used to extract entities for fact-based correction. */
export interface CorrectionMetadata {
  title?: string | null;
  showTitle?: string | null;
  description?: string | null;
}

/**
 * Extract entity candidates (people, companies, products, technical terms) from
 * podcast metadata via a single lightweight LLM call. These become "known
 * entities" the correction pass uses to fix ASR mis-transcriptions of names.
 * Returns an empty array on any failure so the pipeline degrades gracefully.
 */
export async function extractEntities(
  client: OpenAIClient,
  metadata: CorrectionMetadata,
): Promise<string[]> {
  return (await extractEntitiesWithCost(client, metadata)).entities;
}

async function extractEntitiesWithCost(
  client: OpenAIClient,
  metadata: CorrectionMetadata,
): Promise<{ entities: string[]; costUsd: number }> {
  const parts: string[] = [];
  if (metadata.title) parts.push(`标题：${metadata.title}`);
  if (metadata.showTitle) parts.push(`节目：${metadata.showTitle}`);
  if (metadata.description) parts.push(`简介：${sanitizeForPrompt(metadata.description.slice(0, 800))}`);
  if (parts.length === 0) return { entities: [], costUsd: 0 };

  const prompt = [
    '从以下播客元信息中提取所有专有实体（人名、公司名、产品名、技术术语、项目名）。',
    '这些实体将用于校正语音转写中的错误。包含中英文写法。',
    '严格只输出 JSON：{"entities": ["实体1", "实体2", ...]}',
    '',
    ...parts,
  ].join('\n');
  if (prompt.length > MAX_CORRECTION_PROMPT_CHARS) {
    logger.warn('entity extraction exceeds prompt budget, skipping', { promptChars: prompt.length });
    return { entities: [], costUsd: 0 };
  }

  let costUsd = 0;
  try {
    const resp = await client.completeWithRetry([{ role: 'user', content: prompt }], 1000, 1, true);
    costUsd = estimateCorrectionCostUsd(resp.usage);
    const fenced = resp.content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? resp.content;
    const start = fenced.indexOf('[');
    const end = fenced.lastIndexOf(']');
    if (start < 0 || end < 0) return { entities: [], costUsd };
    const entities = JSON.parse(fenced.slice(start, end + 1)) as string[];
    const valid = entities.filter((e) => typeof e === 'string' && e.trim().length > 0).slice(0, 50);
    logger.info('entity extraction done', { count: valid.length });
    return { entities: valid, costUsd };
  } catch (err) {
    logger.warn('entity extraction failed, skipping', { error: String(err) });
    return { entities: [], costUsd };
  }
}

/**
 * Build one correction batch, retaining the original global turn indices.
 * Instructing JSON output keeps the response parseable and bounded.
 */
export function buildCorrectionPrompt(
  turns: CorrectionInput[],
  glossary: CorrectionGlossary,
): string {
  const gloss = glossary.terms && Object.keys(glossary.terms).length > 0
    ? `\n术语词典（严格按此纠正，不要改义）：\n${JSON.stringify(glossary.terms, null, 0)}`
    : '';

  const entitySection = glossary.entities && glossary.entities.length > 0
    ? `\n【已知实体】${glossary.entities.join(', ')}`
    : '';

  const body = turns
    .map((t) => `${t.turnIndex}\t${t.speakerLabel ?? ''}\t${sanitizeForPrompt(t.text)}`)
    .join('\n');

  const rules = entitySection
    ? [
        '1) 术语纠错：按术语词典把常见转写错误纠正为标准写法。',
        '2) 口癖压缩：删除「然后」「那个」「就是」「对吧」等无意义高频填充词，但保留语义必要的连接词。',
        '3) 中英夹杂规范：英文单词与中文之间加空格，专有名词首字母大写（如 OpenAI、GPT-4）。',
        '4) 实体校正：根据上方「已知实体」列表，把转写中错误的人名/公司名/产品名纠正为正确写法。仅校正已有实体的写法，不引入新实体。',
      ]
    : [
        '1) 术语纠错：按术语词典把常见转写错误纠正为标准写法。',
        '2) 口癖压缩：删除「然后」「那个」「就是」「对吧」等无意义高频填充词，但保留语义必要的连接词。',
        '3) 中英夹杂规范：英文单词与中文之间加空格，专有名词首字母大写（如 OpenAI、GPT-4）。',
      ];

  return [
    '你是一名中文播客转写校对员。下面是一集播客的逐句转写（格式：序号\\t说话人\\t文本）。',
    `请做最小必要的${entitySection ? '四' : '三'}类修正，绝不改变原意、不增删信息、不改写数字与专有名词以外的内容：`,
    ...rules,
    '每个序号对应固定的音频时间区间。必须逐条独立校正；禁止将词语或短语移动到相邻序号，禁止合并或拆分条目，即使一句话跨越两个序号也必须保留原来的边界。',
    gloss,
    entitySection,
    '\n严格只输出 JSON：{"corrections": {"<turnIndex>": "<修正后文本>"}}。只包含需要修正的句子；无需修正的句子不要列出。',
    `\n转写内容：\n${body}`,
  ].join('\n');
}

/**
 * Parse the LLM JSON response into a turnIndex -> text map.
 * Tolerant of code fences and leading/trailing prose.
 */
export function parseCorrectionResponse(raw: string): Record<string, string> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end < 0) return {};
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as {
      corrections?: Record<string, string>;
    };
    const corrections = parsed.corrections;
    if (!corrections || typeof corrections !== 'object' || Array.isArray(corrections)) return {};
    return Object.fromEntries(Object.entries(corrections).filter(([, text]) => typeof text === 'string' && text.trim().length > 0));
  } catch {
    return {};
  }
}

// Keep local model requests small enough for the 90-second client timeout.
// The character budget includes rules, glossary, entities, labels and sanitized text.
const MAX_CORRECTION_PROMPT_CHARS = 6000;
const MAX_CORRECTION_BATCH_TURNS = 24;

function* correctionBatches(turns: CorrectionInput[], glossary: CorrectionGlossary): Generator<number[]> {
  let batch: number[] = [];
  for (let index = 0; index < turns.length; index++) {
    const candidate = [...batch, index];
    if (candidate.length > MAX_CORRECTION_BATCH_TURNS ||
      buildCorrectionPrompt(candidate.map((i) => turns[i]), glossary).length > MAX_CORRECTION_PROMPT_CHARS) {
      if (batch.length > 0) yield batch;
      batch = [];
      const promptChars = buildCorrectionPrompt([turns[index]], glossary).length;
      if (promptChars > MAX_CORRECTION_PROMPT_CHARS) {
        logger.warn('correction turn exceeds prompt budget, using glossary-only', {
          turnIndex: turns[index].turnIndex, promptChars, maxPromptChars: MAX_CORRECTION_PROMPT_CHARS,
        });
        continue;
      }
    }
    batch.push(index);
  }
  if (batch.length > 0) yield batch;
}

function boundaryTokens(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) ?? [];
}

function phraseCount(tokens: string[], phrase: string[]): number {
  let count = 0;
  for (let i = 0; i <= tokens.length - phrase.length; i++) {
    if (phrase.every((token, j) => tokens[i + j] === token)) count++;
  }
  return count;
}

function hasBoundaryTransfer(
  sourceBefore: string[], sourceAfter: string[], targetBefore: string[], targetAfter: string[], fromStart: boolean,
): boolean {
  for (let length = 1; length < Math.min(sourceBefore.length, targetAfter.length); length++) {
    const phrase = fromStart ? sourceBefore.slice(0, length) : sourceBefore.slice(-length);
    const added = fromStart ? targetAfter.slice(-length) : targetAfter.slice(0, length);
    if (!phrase.every((token, i) => added[i] === token)) continue;
    const sourceAnchor = fromStart ? sourceBefore[length] : sourceBefore.at(-length - 1);
    const targetAnchor = fromStart ? targetAfter.at(-length - 1) : targetAfter[length];
    if (sourceAnchor !== (fromStart ? sourceAfter[0] : sourceAfter.at(-1)) ||
      targetAnchor !== (fromStart ? targetBefore.at(-1) : targetBefore[0])) continue;
    if (phraseCount(sourceBefore, phrase) > phraseCount(sourceAfter, phrase) &&
      phraseCount(targetAfter, phrase) > phraseCount(targetBefore, phrase)) return true;
  }
  return false;
}

function rejectBoundaryTransfers(baseline: CorrectionOutput[], candidates: CorrectionOutput[]): Set<number> {
  const original = baseline.map((turn) => boundaryTokens(turn.text));
  const corrected = candidates.map((turn) => boundaryTokens(turn.text));
  const rejected = new Set<number>();
  // Compare the complete candidate set before reverting, including adjacent turns in different batches.
  for (let i = 0; i < baseline.length - 1; i++) {
    const originalPair = [...original[i], ...original[i + 1]];
    const correctedPair = [...corrected[i], ...corrected[i + 1]];
    const onlyBoundaryChanged = original[i].length !== corrected[i].length &&
      originalPair.length === correctedPair.length && originalPair.every((token, j) => token === correctedPair[j]);
    if (onlyBoundaryChanged ||
      hasBoundaryTransfer(original[i + 1], corrected[i + 1], original[i], corrected[i], true) ||
      hasBoundaryTransfer(original[i], corrected[i], original[i + 1], corrected[i + 1], false)) {
      rejected.add(i);
      rejected.add(i + 1);
      logger.warn('correction moved content across fixed turn boundaries, rejecting candidates', {
        turnIndices: [baseline[i].turnIndex, baseline[i + 1].turnIndex],
      });
    }
  }
  return rejected;
}

/**
 * Apply glossary term substitutions as a deterministic first pass (no LLM cost),
 * so obvious errors are fixed even when the LLM is unavailable.
 */
export function applyGlossaryPass(turns: CorrectionInput[], glossary: CorrectionGlossary): CorrectionOutput[] {
  const terms = glossary.terms ?? {};
  const compiled = Object.entries(terms).map(([wrong, right]) => {
    // whole-token, case-insensitive; escape regex specials in the wrong term.
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { re: new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'gi'), right };
  });

  return turns.map((t) => {
    let text = t.text;
    let count = 0;
    for (const { re, right } of compiled) {
      const before = text;
      text = text.replace(re, (_m, pre, post) => {
        count++;
        return `${pre}${right}${post}`;
      });
      if (text !== before) count = count; // count already incremented in replace
    }
    return { turnIndex: t.turnIndex, text, corrections: count };
  });
}

/**
 * Run the full correction pass: deterministic glossary pass, then an LLM pass
 * for口癖 + mixed-language normalization. Falls back to glossary-only on LLM
 * failure so the pipeline never blocks on a flaky model.
 */
export async function runCorrectionPass(
  turns: CorrectionInput[],
  client: OpenAIClient,
  glossary: CorrectionGlossary = {},
  metadata?: CorrectionMetadata,
): Promise<{ outputs: CorrectionOutput[]; costUsd: number }> {
  const glossaryResult = applyGlossaryPass(turns, glossary);

  if (turns.length === 0) return { outputs: [], costUsd: 0 };

  // Extract entities from podcast metadata for fact-based correction.
  // Failure is non-fatal — we proceed with the existing three-rule pass.
  let entities: string[] = [];
  let costUsd = 0;
  if (metadata && (metadata.title || metadata.showTitle || metadata.description)) {
    const extracted = await extractEntitiesWithCost(client, metadata);
    entities = extracted.entities;
    costUsd += extracted.costUsd;
  }
  const enrichedGlossary: CorrectionGlossary = {
    ...glossary,
    ...(entities.length > 0 ? { entities } : {}),
  };

  const out = [...glossaryResult];
  let llmCorrected = 0;
  let batches = 0;
  let failedBatches = 0;
  for (const indices of correctionBatches(turns, enrichedGlossary)) {
    batches++;
    try {
      const prompt = buildCorrectionPrompt(indices.map((i) => turns[i]), enrichedGlossary);
      // No automatic replay: some local servers keep computing after a client timeout.
      const resp = await client.completeWithRetry([{ role: 'user', content: prompt }], 4000, 1, true);
      costUsd += estimateCorrectionCostUsd(resp.usage);
      const llmMap = parseCorrectionResponse(resp.content);
      for (const index of indices) {
        const g = glossaryResult[index];
        const llmText = llmMap[String(g.turnIndex)];
        if (llmText) {
          out[index] = { turnIndex: g.turnIndex, text: llmText.trim(), corrections: g.corrections + 1 };
          llmCorrected++;
        }
      }
      logger.info('correction LLM batch done', { batch: batches, turns: indices.length, promptChars: prompt.length });
    } catch (err) {
      failedBatches++;
      logger.warn('correction LLM batch failed, using glossary-only', {
        batch: batches, turnIndices: indices.map((i) => turns[i].turnIndex), error: String(err),
      });
    }
  }

  const boundaryRejected = rejectBoundaryTransfers(glossaryResult, out);
  for (const index of boundaryRejected) {
    if (out[index] !== glossaryResult[index]) llmCorrected--;
    out[index] = glossaryResult[index];
  }

  logger.info('correction pass done', {
    turns: turns.length,
    llmCorrected,
    batches,
    failedBatches,
    boundaryRejected: boundaryRejected.size,
    glossaryCorrected: glossaryResult.filter((g) => g.corrections > 0).length,
    entitiesExtracted: entities.length,
  });
  return { outputs: out, costUsd: Math.round(costUsd * 10000) / 10000 };
}

/** Rough USD cost from token usage (DeepSeek-class: ~$0.14/1M in, $0.28/1M out). */
function estimateCorrectionCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  const inCost = (usage.inputTokens / 1_000_000) * 0.14;
  const outCost = (usage.outputTokens / 1_000_000) * 0.28;
  return inCost + outCost;
}
