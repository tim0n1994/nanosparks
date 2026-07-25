/**
 * Episode Chinese summary — translates a non-zh episode into a structured
 * Chinese title + overview + per-topic bullets, for the multi-episode picker.
 *
 * Detection is a cheap CJK heuristic so we never waste an LLM call on
 * already-Chinese shows. Generation is a single cheap-model call per episode,
 * triggered lazily (on row expand).
 */

import { OpenAIClient } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { EPISODE_SUMMARY_PROMPT } from '@/lib/llm/prompts/episode-summary';
import { z } from 'zod';

const summarySchema = z.object({
  translatedTitle: z.string(),
  summary: z.string(),
  topics: z.array(z.object({ time: z.string(), title: z.string() })).default([]),
});

export interface EpisodeTopic {
  time: string;
  title: string;
}

export interface EpisodeSummary {
  translatedTitle: string;
  summary: string;
  topics: EpisodeTopic[];
}

/**
 * Pure: estimate whether text is predominantly Chinese (CJK). Returns true when
 * the CJK-character ratio is high enough that translation is unnecessary.
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
  const denom = cjk + letters;
  return denom > 0 && cjk / denom >= 0.25;
}

/**
 * Generate a structured Chinese summary for an episode. `fullDescription`
 * should be the rich shownotes (with chapters if available). Skips the LLM call
 * (returns null) when the episode is already mostly Chinese.
 */
export async function summarizeEpisode(
  title: string,
  fullDescription: string | null | undefined,
  chapters?: string[],
): Promise<EpisodeSummary | null> {
  const combined = `${title}\n${fullDescription ?? ''}`;
  if (isMostlyChinese(combined)) return null;

  let client: OpenAIClient;
  try {
    const s = await getLlmSettings();
    if (s.apiFormat === 'anthropic') return null;
    client = new OpenAIClient(s.apiKey, s.model, s.baseUrl);
  } catch {
    return null;
  }

  const chaptersBlock = chapters && chapters.length > 0
    ? `章节：\n${chapters.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    : '';

  const prompt = EPISODE_SUMMARY_PROMPT
    .replace('{{title}}', title.slice(0, 300))
    .replace('{{description}}', (fullDescription ?? '').slice(0, 3000))
    .replace('{{chapters}}', chaptersBlock);

  try {
    return await client.completeStructured(
      [{ role: 'user', content: prompt }],
      summarySchema,
      { maxTokens: 768, schemaName: 'episode_summary' },
    );
  } catch {
    return null;
  }
}
