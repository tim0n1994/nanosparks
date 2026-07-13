/**
 * Speaker Label Mapper
 *
 * Maps Deepgram diarization labels (speaker_0, speaker_1) to real names
 * using LLM analysis of the transcript content.
 */

import { OpenAIClient } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { SPEAKER_NAME_PROMPT } from '@/lib/llm/prompts/speaker-name-mapping';
import { logger } from '@/lib/logger';

/**
 * Extract a sample from transcript segments for LLM name inference.
 * Takes first ~2000 chars with speaker labels visible.
 */
function buildTranscriptSample(
  segments: Array<{ text: string; start: number; speakerId?: string }>,
): string {
  const lines: string[] = [];
  let charCount = 0;
  for (const seg of segments) {
    const label = seg.speakerId || 'unknown';
    lines.push(`[${label}] ${seg.text}`);
    charCount += seg.text.length;
    if (charCount > 2000) break;
  }
  return lines.join('\n');
}

/**
 * Map anonymous speaker labels to real names using LLM.
 * Falls back to the LLM-derived speaker list if name mapping fails.
 */
export async function mapSpeakerNames(
  transcriptSegments: Array<{ text: string; start: number; speakerId?: string }>,
): Promise<Record<string, string>> {
  // Find all unique anonymous speaker labels from Deepgram
  const anonymousLabels = new Set<string>();
  for (const seg of transcriptSegments) {
    if (seg.speakerId && /^speaker_\d+$/.test(seg.speakerId)) {
      anonymousLabels.add(seg.speakerId);
    }
  }

  if (anonymousLabels.size === 0) {
    return {};
  }

  if (anonymousLabels.size > 10) {
    logger.warn(`Too many anonymous speakers (${anonymousLabels.size}), skipping name mapping`);
    return {};
  }

  try {
    const sample = buildTranscriptSample(transcriptSegments);
    const llmSettings = await getLlmSettings();
    const client = new OpenAIClient(llmSettings.apiKey, llmSettings.model, llmSettings.baseUrl);

    const response = await client.complete([
      { role: 'user', content: SPEAKER_NAME_PROMPT.replace('{{transcript}}', sample) },
    ], 512);

    // Parse LLM response: {"speaker_0": "名字", "speaker_1": "名字"}
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const mapping = JSON.parse(jsonMatch[0]) as Record<string, string>;
      const result: Record<string, string> = {};
      for (const [anon, name] of Object.entries(mapping)) {
        if (anonymousLabels.has(anon) && typeof name === 'string' && name.length > 0) {
          result[anon] = name;
        }
      }
      logger.info(`Speaker name mapping resolved`, { mapping: result });
      return result;
    }
  } catch (error) {
    logger.warn('Speaker name mapping failed', { error: String(error) });
  }

  return {};
}
