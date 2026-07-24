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
  const parts: string[] = [];
  if (metadata.title) parts.push(`标题：${metadata.title}`);
  if (metadata.showTitle) parts.push(`节目：${metadata.showTitle}`);
  if (metadata.description) parts.push(`简介：${sanitizeForPrompt(metadata.description.slice(0, 800))}`);
  if (parts.length === 0) return [];

  const prompt = [
    '从以下播客元信息中提取所有专有实体（人名、公司名、产品名、技术术语、项目名）。',
    '这些实体将用于校正语音转写中的错误。包含中英文写法。',
    '严格只输出 JSON：{"entities": ["实体1", "实体2", ...]}',
    '',
    ...parts,
  ].join('\n');

  try {
    const resp = await client.completeWithRetry([{ role: 'user', content: prompt }], 1000, 2, true);
    const fenced = resp.content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? resp.content;
    const start = fenced.indexOf('[');
    const end = fenced.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const entities = JSON.parse(fenced.slice(start, end + 1)) as string[];
    const valid = entities.filter((e) => typeof e === 'string' && e.trim().length > 0).slice(0, 50);
    logger.info('entity extraction done', { count: valid.length });
    return valid;
  } catch (err) {
    logger.warn('entity extraction failed, skipping', { error: String(err) });
    return [];
  }
}

/**
 * Build the correction prompt. We feed the full turn list in one pass (episodes
 * are short enough at the turn level) and ask for a JSON map {turnIndex: text}.
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
    return parsed.corrections ?? {};
  } catch {
    return {};
  }
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
  if (metadata && (metadata.title || metadata.showTitle || metadata.description)) {
    entities = await extractEntities(client, metadata);
  }
  const enrichedGlossary: CorrectionGlossary = {
    ...glossary,
    ...(entities.length > 0 ? { entities } : {}),
  };

  let llmMap: Record<string, string> = {};
  let costUsd = 0;
  try {
    const prompt = buildCorrectionPrompt(turns, enrichedGlossary);
    const resp = await client.completeWithRetry([{ role: 'user', content: prompt }], 4000, 3, true);
    llmMap = parseCorrectionResponse(resp.content);
    costUsd = estimateCorrectionCostUsd(resp.usage);
  } catch (err) {
    logger.warn('correction LLM pass failed, using glossary-only', { error: String(err) });
    return { outputs: glossaryResult, costUsd: 0 };
  }

  // Merge: LLM text wins where present, else glossary text.
  const out: CorrectionOutput[] = glossaryResult.map((g) => {
    const llmText = llmMap[String(g.turnIndex)];
    if (llmText) {
      return { turnIndex: g.turnIndex, text: llmText.trim(), corrections: g.corrections + 1 };
    }
    return g;
  });

  logger.info('correction pass done', {
    turns: turns.length,
    llmCorrected: Object.keys(llmMap).length,
    glossaryCorrected: glossaryResult.filter((g) => g.corrections > 0).length,
    entitiesExtracted: entities.length,
  });
  return { outputs: out, costUsd };
}

/** Rough USD cost from token usage (DeepSeek-class: ~$0.14/1M in, $0.28/1M out). */
function estimateCorrectionCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  const inCost = (usage.inputTokens / 1_000_000) * 0.14;
  const outCost = (usage.outputTokens / 1_000_000) * 0.28;
  return Math.round((inCost + outCost) * 10000) / 10000;
}
