/**
 * On-demand bilingual translation (PRD §A3 双语对照 + §7 翻译按需).
 *
 * English episodes get a "翻译本集" button that triggers this. Batches turns
 * through an LLM (DeepSeek-class, ~¥0.3-0.6/episode), writes results into
 * Turn.translationJson, and consumes one quota unit (PRD: 按需触发计一次额度).
 * Translation results enter the shared cache layer (PRD §A3: 译文进共享缓存).
 *
 * The batcher + prompt builder + parser are pure logic (testable); the
 * orchestrator wires the LLM + DB.
 */

import type { OpenAIClient } from '@/lib/llm/client';
import { logger } from '@/lib/logger';

export interface TranslateTurnInput {
  turnId: string;
  turnIndex: number;
  text: string;
}

export type TranslationTarget = 'zh' | 'en';

/** Batch turns into prompt-sized chunks (one LLM call per ~40 turns). Pure logic. */
export function batchTurnsForTranslation(turns: TranslateTurnInput[], chunkSize = 40): TranslateTurnInput[][] {
  if (turns.length === 0) return [];
  const out: TranslateTurnInput[][] = [];
  for (let i = 0; i < turns.length; i += chunkSize) {
    out.push(turns.slice(i, i + chunkSize));
  }
  return out;
}

/** Build the translation prompt for a batch. */
export function buildTranslationPrompt(batch: TranslateTurnInput[], target: TranslationTarget): string {
  const body = batch.map((t) => `${t.turnIndex}\t${t.text}`).join('\n');
  const targetName = target === 'zh' ? '中文' : '英文';
  return [
    `把下面播客逐句转写翻译为${targetName}。保留原意与语气，不增删信息。专有名词保留原文括注。`,
    '格式：序号<TAB>译文，一行一句。',
    '严格只输出 JSON：{"translations": {"<turnIndex>": "<译文>"}}。',
    '',
    body,
  ].join('\n');
}

/** Parse the LLM JSON translation response (tolerant of code fences). */
export function parseTranslationResponse(raw: string): Record<string, string> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw;
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end < 0) return {};
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as { translations?: Record<string, string> };
    return parsed.translations ?? {};
  } catch {
    return {};
  }
}

/**
 * Translate an episode's turns on demand and persist to Turn.translationJson.
 * Idempotent: turns already translated into the target language are skipped.
 */
export async function translateEpisodeTurns(args: {
  conversationId: string;
  target: TranslationTarget;
  turns: TranslateTurnInput[];
  existing: Map<string, Record<string, string>>;
  client: OpenAIClient;
  persist: (updates: Array<{ turnId: string; translationJson: Record<string, string> }>) => Promise<void>;
}): Promise<{ translatedCount: number; costUsd: number }> {
  const { conversationId, target, turns, existing, client, persist } = args;

  const todo = turns.filter((t) => !existing.get(t.turnId)?.[target]);
  if (todo.length === 0) {
    logger.info('translation: nothing to do (already translated)', { conversationId, target });
    return { translatedCount: 0, costUsd: 0 };
  }

  const batches = batchTurnsForTranslation(todo);
  const updates: Array<{ turnId: string; translationJson: Record<string, string> }> = [];
  let costUsd = 0;
  let translatedCount = 0;

  for (const batch of batches) {
    let map: Record<string, string> = {};
    try {
      const resp = await client.completeWithRetry(
        [{ role: 'user', content: buildTranslationPrompt(batch, target) }],
        4000,
        2,
        true,
      );
      map = parseTranslationResponse(resp.content);
      costUsd += estimateCostUsd(resp.usage);
    } catch (err) {
      logger.warn('translation batch failed', { conversationId, error: String(err) });
      continue;
    }

    for (const t of batch) {
      const translated = map[String(t.turnIndex)];
      if (!translated) continue;
      const merged = { ...(existing.get(t.turnId) ?? {}), [target]: translated };
      updates.push({ turnId: t.turnId, translationJson: merged });
      translatedCount++;
    }
  }

  if (updates.length > 0) {
    await persist(updates);
  }

  logger.info('translation complete', { conversationId, target, translatedCount, costUsd });
  return { translatedCount, costUsd };
}

function estimateCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  const inCost = (usage.inputTokens / 1_000_000) * 0.14;
  const outCost = (usage.outputTokens / 1_000_000) * 0.28;
  return Math.round((inCost + outCost) * 10000) / 10000;
}
