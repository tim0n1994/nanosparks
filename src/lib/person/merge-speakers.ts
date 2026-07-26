/**
 * P1 (LLM fallback): merge anonymous speakers into named participants.
 *
 * After P-1, turns are attributed to anonymous diarization labels (SPEAKER_00/01)
 * via the segment timeline. Named participants (Marc Andreessen/guest, Swyx/host...)
 * exist with role + real name but hold zero turns, because the analyze.ts
 * speaker-identification path created them but didn't produce a per-turn map for
 * this conversation. This module closes that gap WITHOUT audio/voiceprints:
 *
 *   - load the conversation's NAMED participants (role + name)
 *   - ask the LLM to assign each turn to one of them (existing SPEAKER_ASSIGNMENT_PROMPT)
 *   - remap Turn.participantId in place to the named participant (preserve ids)
 *
 * This is the deterministic, no-audio path. True voiceprint clustering (P1 ideal)
 * needs pyannote embeddings + audio and supersedes this when available; until then
 * this LLM path is what lets a person's profile reflect their actual speech.
 *
 * Pure helper `assignTurnsToNamedSpeakers` is exported for unit testing.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getLlmSettings } from '@/lib/settings';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { SPEAKER_ASSIGNMENT_PROMPT } from '@/lib/llm/prompts/speaker-assignment';
import { z } from 'zod';
import { isNamedSpeaker } from '@/lib/person/identity-resolver';

const SpeakerAssignmentSchema = z.array(z.object({
  turnIndex: z.number(),
  speakerId: z.string(),
}));

async function makeDefaultClient(): Promise<OpenAIClient | ClaudeClient> {
  const settings = await getLlmSettings();
  if (settings.apiFormat === 'anthropic') {
    return new ClaudeClient(settings.apiKey, settings.model, settings.baseUrl);
  }
  return new OpenAIClient(settings.apiKey, settings.model, settings.baseUrl);
}

/**
 * Pure: turn a raw LLM response string into a turnIndex->participantId map,
 * validated against the known named-speaker ids. Drops anything malformed.
 */
export function assignTurnsToNamedSpeakers(
  rawResponse: string,
  namedSpeakers: Array<{ id: string; name: string }>,
): Map<number, string> {
  const validIds = new Set(namedSpeakers.map((s) => s.id));
  const out = new Map<number, string>();
  let parsed: unknown;
  try {
    // tolerate markdown fences / leading prose
    const cleaned = rawResponse.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    parsed = start >= 0 && end > start ? JSON.parse(cleaned.slice(start, end + 1)) : JSON.parse(cleaned);
  } catch {
    return out;
  }
  const assignments = SpeakerAssignmentSchema.safeParse(parsed);
  if (!assignments.success) return out;
  for (const a of assignments.data) {
    if (validIds.has(a.speakerId)) out.set(a.turnIndex, a.speakerId);
  }
  return out;
}

export interface MergeSpeakersResult {
  conversationId: string;
  namedSpeakers: number;
  turnsTotal: number;
  turnsRemapped: number;
  bySpeaker: Record<string, number>;
}

/**
 * DB-backed: merge anonymous turns into named participants for a conversation.
 * Uses the LLM speaker-assignment prompt over the named-speaker set. Idempotent
 * (re-running just re-attributes). Skips conversations with <2 named speakers
 * or no turns.
 */
export async function mergeSpeakersForConversation(
  conversationId: string,
  opts: { client?: OpenAIClient | ClaudeClient } = {},
): Promise<MergeSpeakersResult> {
  const named = await prisma.participant.findMany({
    where: { conversationId },
    select: { id: true, name: true, role: true, speakerLabel: true },
  });
  const namedSpeakers = named.filter((p) => isNamedSpeaker(p.name));
  const turns = await prisma.turn.findMany({
    where: { conversationId },
    orderBy: { turnIndex: 'asc' },
    select: { id: true, turnIndex: true, text: true },
  });
  if (namedSpeakers.length < 2 || turns.length === 0) {
    return { conversationId, namedSpeakers: namedSpeakers.length, turnsTotal: turns.length, turnsRemapped: 0, bySpeaker: {} };
  }

  // Cap the transcript for token budget (same sampling as analyze.ts).
  const MAX_CHARS = 18000;
  let selected = turns;
  const totalChars = turns.reduce((n, t) => n + t.text.length, 0);
  if (totalChars > MAX_CHARS) {
    selected = [];
    // Sample up to 40 evenly-spaced turns (keeps the prompt small for cheaper
    // models; voice continuity fill-in covers the gaps).
    const target = 40;
    const step = Math.max(1, Math.floor(turns.length / target));
    for (let i = 0; i < turns.length && selected.length < target; i += step) selected.push(turns[i]);
  }
  logger.info('merge-speakers prompt prepared', {
    conversationId,
    turnsTotal: turns.length,
    sampled: selected.length,
    totalChars,
    sampledChars: selected.reduce((n, t) => n + t.text.length, 0),
    namedSpeakers: namedSpeakers.length,
  });
  const turnsBlock = selected
    .map((t) => `{ "turnIndex": ${t.turnIndex}, "text": ${JSON.stringify(t.text.slice(0, 280))} }`)
    .join(',\n');
  // Use the speaker's DB id as the assignment key (the prompt calls it "speakerId").
  const speakersBlock = namedSpeakers
    .map((s) => `{ "id": ${JSON.stringify(s.id)}, "name": ${JSON.stringify(s.name)} }`)
    .join(',\n');

  const client = opts.client ?? (await makeDefaultClient());
  let map = new Map<number, string>();
  // Both OpenAIClient and ClaudeClient share completeWithRetry via BaseLLMClient.
  const response = await client.completeWithRetry([
    { role: 'user', content: SPEAKER_ASSIGNMENT_PROMPT
        .replace('{{speakers}}', `[${speakersBlock}]`)
        .replace('{{turns}}', `[${turnsBlock}]`) },
  ], 4096, 3);
  map = assignTurnsToNamedSpeakers(response.content, namedSpeakers);

  // Remap turns: if the LLM assigned the sampled turn, carry its index; for
  // non-sampled turns, inherit the nearest sampled assignment (voice continuity).
  const sampledByIndex = new Map(selected.map((t) => [t.turnIndex, t.turnIndex]));
  const sortedSampledIdx = [...map.keys()].sort((a, b) => a - b);
  let turnsRemapped = 0;
  const bySpeaker: Record<string, number> = {};
  for (const turn of turns) {
    let targetId = map.get(turn.turnIndex);
    if (!targetId && sortedSampledIdx.length > 0 && !sampledByIndex.has(turn.turnIndex)) {
      // nearest preceding sampled assignment
      let lo = -1;
      for (const idx of sortedSampledIdx) { if (idx <= turn.turnIndex) lo = idx; else break; }
      if (lo >= 0) targetId = map.get(lo);
    }
    if (targetId) {
      await prisma.turn.update({ where: { id: turn.id }, data: { participantId: targetId } });
      turnsRemapped++;
      bySpeaker[targetId] = (bySpeaker[targetId] ?? 0) + 1;
    }
  }

  logger.info('Merged anonymous speakers into named participants', {
    conversationId,
    namedSpeakers: namedSpeakers.length,
    turnsTotal: turns.length,
    turnsRemapped,
  });
  return { conversationId, namedSpeakers: namedSpeakers.length, turnsTotal: turns.length, turnsRemapped, bySpeaker };
}
