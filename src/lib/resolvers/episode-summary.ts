/**
 * Episode Chinese summary — translates a non-zh episode's title + description
 * into a concise Chinese title + one-line summary, for the multi-episode picker.
 *
 * Detection is a cheap heuristic (CJK ratio) so we never waste an LLM call on
 * already-Chinese shows. Generation is a single cheap-model call per episode,
 * meant to be triggered lazily (on row expand), not for the whole list at once.
 */

import { OpenAIClient } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { EPISODE_SUMMARY_PROMPT } from '@/lib/llm/prompts/episode-summary';
import { z } from 'zod';

const summarySchema = z.object({
  translatedTitle: z.string(),
  summary: z.string(),
});

export interface EpisodeSummary {
  translatedTitle: string;
  summary: string;
}

/**
 * Pure: estimate whether text is predominantly Chinese (CJK). Returns true when
 * the CJK-character ratio is high enough that translation is unnecessary.
 * Exported for unit testing the heuristic without an LLM.
 */
export function isMostlyChinese(text: string | null | undefined): boolean {
  const s = text ?? '';
  if (s.length === 0) return false;
  let cjk = 0;
  let letters = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk++;
    if (/[a-zA-Z]/.test(ch)) letters++;
  }
  // If at least 25% of the letter-ish chars are CJK, treat as Chinese.
  const denom = cjk + letters;
  return denom > 0 && cjk / denom >= 0.25;
}

/**
 * Generate a Chinese title + one-line summary for an episode. Skips the LLM call
 * (returns null) when the episode is already mostly Chinese.
 */
export async function summarizeEpisode(
  title: string,
  description: string | null | undefined,
): Promise<EpisodeSummary | null> {
  const combined = `${title}\n${description ?? ''}`;
  if (isMostlyChinese(combined)) return null;

  let client: OpenAIClient;
  try {
    const s = await getLlmSettings();
    if (s.apiFormat === 'anthropic') {
      // Arbitration uses OpenAI-shape structured output; skip if unavailable.
      return null;
    }
    client = new OpenAIClient(s.apiKey, s.model, s.baseUrl);
  } catch {
    return null;
  }

  const prompt = EPISODE_SUMMARY_PROMPT
    .replace('{{title}}', title.slice(0, 300))
    .replace('{{description}}', (description ?? '').slice(0, 1500));
  try {
    return await client.completeStructured(
      [{ role: 'user', content: prompt }],
      summarySchema,
      { maxTokens: 256, schemaName: 'episode_summary' },
    );
  } catch {
    return null;
  }
}
