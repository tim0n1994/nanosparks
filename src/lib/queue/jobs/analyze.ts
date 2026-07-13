/**
 * Analyze Job
 *
 * Supports two paths:
 * 1. Episode-based (legacy YouTube): { episodeId } — reads transcript from Episode.transcript
 * 2. Conversation-only (upload/transcript): { conversationId } — reads turns from Turn table
 *
 * Both paths produce Analysis JSON (backward compat) + ThoughtUnits + EvidenceSpans.
 */

import { prisma } from '@/lib/prisma';
import { OpenAIClient, validateJsonResponse } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { ARGUMENT_EXTRACTION_PROMPT } from '@/lib/llm/prompts/argument-extraction';
import { SPEAKER_IDENTIFICATION_PROMPT } from '@/lib/llm/prompts/speaker-identification';
import { TOPIC_EXTRACTION_PROMPT } from '@/lib/llm/prompts/topic-extraction';
import { QUOTE_EXTRACTION_PROMPT } from '@/lib/llm/prompts/quote-extraction';
import { REFERENCE_GENERATION_PROMPT } from '@/lib/llm/prompts/reference-generation';
import { SUMMARY_GENERATION_PROMPT } from '@/lib/llm/prompts/summary-generation';
import { logger } from '@/lib/logger';
import { toPrismaJson } from '@/lib/prisma-json';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { updateConversationStatus } from '@/lib/adapters/episode-to-conversation';
import { rebuildCorpusGraph } from '@/lib/graph/builder';
import { generateEmbeddings } from '@/lib/embeddings';
import { storeEmbeddings } from '@/lib/embeddings/search';
import { mapSpeakerNames } from '@/lib/transcription/speaker-mapper';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';

interface AnalyzeJobData {
  episodeId?: string;
  conversationId?: string;
  sourceId?: string;
}

const ArgumentSchema = z.array(z.object({
  id: z.string(),
  text: z.string(),
  speakerId: z.string(),
  type: z.enum(['claim', 'support', 'oppose', 'refine']),
  parentId: z.string().nullable(),
  timestamp: z.number(),
}));

const SpeakerSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
}));

const TopicSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  mentionCount: z.number(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  timestamps: z.array(z.number()),
}));

const QuoteSchema = z.array(z.object({
  id: z.string(),
  text: z.string(),
  speakerId: z.string(),
  timestamp: z.number(),
  context: z.string(),
}));

const ReferenceSchema = z.array(z.object({
  url: z.string(),
  title: z.string(),
  description: z.string(),
  relevanceScore: z.number(),
}));

const SummarySchema = z.object({
  summary: z.string(),
  takeaways: z.array(z.string()),
  language: z.string(),
  host: z.string().optional(),
});

export async function processAnalyzeJob(data: AnalyzeJobData): Promise<void> {
  const { episodeId, conversationId: explicitConversationId, sourceId } = data;

  if (episodeId) {
    return processEpisodeAnalysis({ episodeId, conversationId: explicitConversationId });
  }

  if (explicitConversationId) {
    return processConversationAnalysis({ conversationId: explicitConversationId, sourceId });
  }

  throw new Error('Analyze job requires either episodeId or conversationId');
}

/**
 * Episode-based analysis (legacy YouTube flow).
 */
async function processEpisodeAnalysis(data: { episodeId: string; conversationId?: string }): Promise<void> {
  const { episodeId } = data;
  const conversationId = data.conversationId || await findConversationId(episodeId);

  await prisma.episode.update({
    where: { id: episodeId },
    data: { status: 'ANALYZING' },
  });

  try {
    const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode || !episode.transcript) {
      throw new Error('Episode or transcript not found');
    }

    const transcriptText = sanitizeForPrompt(
      (typeof episode.transcript === 'object' && Array.isArray(episode.transcript)
        ? episode.transcript
        : (typeof episode.transcript === 'string' ? JSON.parse(episode.transcript) : [])
      ).map((seg: Record<string, unknown>) => {
        const speaker = seg.speaker || seg.speakerId || '';
        const label = speaker ? `[${speaker}] ` : '';
        return `${label}${seg.text}`;
      }).join('\n')
    );
    const llmSettings = await getLlmSettings();
    const client = new OpenAIClient(llmSettings.apiKey, llmSettings.model, llmSettings.baseUrl);

    const { arguments_, speakers, quotes } = await runLlmExtraction(client, transcriptText, episodeId, conversationId);

    // ── Map Deepgram anonymous speaker labels to real names ──
    if (episode.transcript) {
      try {
        const epTranscript = (typeof episode.transcript === 'object' && Array.isArray(episode.transcript)
          ? episode.transcript
          : (typeof episode.transcript === 'string' ? JSON.parse(episode.transcript) : [])
        ) as Array<Record<string, unknown>>;

        const speakerMapping = await mapSpeakerNames(
          epTranscript.map((seg) => ({
            text: (seg.text as string) || '',
            start: (typeof seg.start === 'number' ? seg.start : 0) as number,
            speakerId: ((seg.speaker || seg.speakerId) as string),
          })),
        );

        if (Object.keys(speakerMapping).length > 0) {
          // Replace anonymous labels in transcript with real names
          const mappedTranscript = epTranscript.map((seg) => {
            const anon = (seg.speaker || seg.speakerId) as string | undefined;
            const realName = anon ? speakerMapping[anon] : undefined;
            return realName ? { ...seg, speaker: realName } : seg;
          });
          await prisma.episode.update({
            where: { id: episodeId },
            data: { transcript: toPrismaJson(mappedTranscript) as Prisma.InputJsonValue },
          });
          logger.info(`Speaker names mapped in transcript`, { mapping: speakerMapping });
        }
      } catch (e) {
        logger.warn('Speaker name mapping step failed', { error: String(e) });
      }
    }

    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'COMPLETED' },
    });

    if (conversationId) {
      await syncConversationFromAnalysis(conversationId, speakers as Array<{ id: string; name: string; role?: string }>);
    }

    logger.info(`Analysis completed for episode ${episodeId}`, {
      args: (arguments_ as unknown[]).length,
      conversationId,
    });
  } catch (error) {
    logger.error(`Episode analyze job failed for ${episodeId}`, { error: String(error) });
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'FAILED' },
    }).catch(() => {});
    // Update conversation status on failure (idempotent)
    if (data.conversationId) {
      await updateConversationStatusForConversation(data.conversationId, 'failed');
    } else {
      await updateConversationStatus(episodeId, 'failed');
    }
    throw error;
  }
}

/**
 * Conversation-only analysis (upload/transcript flow, no Episode).
 */
async function processConversationAnalysis(data: { conversationId: string; sourceId?: string }): Promise<void> {
  const { conversationId, sourceId } = data;

  // Update statuses
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'analyzing' },
  });

  if (sourceId) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { status: 'analyzing' },
    }).catch(() => {});
  }

  try {
    // Read turns from Turn table as transcript
    const turns = await prisma.turn.findMany({
      where: { conversationId },
      orderBy: { turnIndex: 'asc' },
      include: { participant: { select: { name: true } } },
    });

    if (turns.length === 0) {
      throw new Error(`No turns found for conversation ${conversationId}`);
    }

    // Build transcript text from turns
    const transcriptSegments = turns.map((t) => ({
      start: t.startMs / 1000,
      end: t.endMs / 1000,
      text: t.text,
      speakerId: t.participant?.name,
    }));

    const transcriptText = sanitizeForPrompt(
      transcriptSegments.map((seg) => `${seg.speakerId ? `[${seg.speakerId}] ` : ''}${seg.text}`).join('\n')
    );
    const llmSettings = await getLlmSettings();
    const client = new OpenAIClient(llmSettings.apiKey, llmSettings.model, llmSettings.baseUrl);

    await runLlmExtraction(client, transcriptText, null, conversationId);

    // Mark as completed
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'completed' },
    });

    if (sourceId) {
      await prisma.source.update({
        where: { id: sourceId },
        data: { status: 'completed' },
      }).catch(() => {});
    }

    // Rebuild corpus insight graph
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { corpusId: true },
    });
    if (conversation) {
      await rebuildCorpusGraph(conversation.corpusId).catch((err) => {
        logger.warn(`Graph rebuild failed for corpus ${conversation.corpusId}`, { error: String(err) });
      });
    }

    logger.info(`Analysis completed for conversation ${conversationId}`);
  } catch (error) {
    logger.error(`Conversation analyze job failed for ${conversationId}`, { error: String(error) });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'failed' },
    }).catch(() => {});
    if (sourceId) {
      await prisma.source.update({
        where: { id: sourceId },
        data: { status: 'failed' },
      }).catch(() => {});
    }
    throw error;
  }
}

/**
 * Core LLM extraction: runs 5 parallel prompts, writes Analysis + ThoughtUnits.
 */
async function runLlmExtraction(
  client: OpenAIClient,
  transcriptText: string,
  episodeId: string | null,
  conversationId: string | null | undefined,
) {
  logger.info('runLlmExtraction start', { transcriptLength: transcriptText.length });

  // Serial LLM calls to avoid upstream rate limits (AliCloud unstable with parallel)
  const argResponse = await client.completeWithRetry([
    { role: 'user', content: ARGUMENT_EXTRACTION_PROMPT.replace('{{transcript}}', transcriptText) },
  ], 4096, 5);
  const speakerResponse = await client.completeWithRetry([
    { role: 'user', content: SPEAKER_IDENTIFICATION_PROMPT.replace('{{transcript}}', transcriptText) },
  ], 4096, 5);
  const topicResponse = await client.completeWithRetry([
    { role: 'user', content: TOPIC_EXTRACTION_PROMPT.replace('{{transcript}}', transcriptText) },
  ], 4096, 5);
  const quoteResponse = await client.completeWithRetry([
    { role: 'user', content: QUOTE_EXTRACTION_PROMPT.replace('{{transcript}}', transcriptText) },
  ], 4096, 5);
  const summaryResponse = await client.completeWithRetry([
    { role: 'user', content: SUMMARY_GENERATION_PROMPT.replace('{{transcript}}', transcriptText) },
  ], 4096, 5);
  logger.info('runLlmExtraction 5 calls done (serial)');

  let arguments_: unknown[] = [];
  let speakers: unknown[] = [];
  let topics: unknown[] = [];
  let quotes: unknown[] = [];
  let summaryJson: unknown = null;

  try { arguments_ = validateJsonResponse(argResponse.content, ArgumentSchema); } catch (e) { logger.warn('Argument extraction failed', { error: String(e) }); }
  try { speakers = validateJsonResponse(speakerResponse.content, SpeakerSchema); } catch (e) { logger.warn('Speaker extraction failed', { error: String(e) }); }
  try { topics = validateJsonResponse(topicResponse.content, TopicSchema); } catch (e) { logger.warn('Topic extraction failed', { error: String(e) }); }
  try { quotes = validateJsonResponse(quoteResponse.content, QuoteSchema); } catch (e) { logger.warn('Quote extraction failed', { error: String(e) }); }
  try { summaryJson = validateJsonResponse(summaryResponse.content, SummarySchema); } catch (e) { logger.warn('Summary extraction failed', { error: String(e) }); }

  const refResponse = await client.completeWithRetry([
    { role: 'user', content: REFERENCE_GENERATION_PROMPT
      .replace('{{transcript}}', transcriptText)
      .replace('{{arguments}}', JSON.stringify(arguments_)) },
  ]);

  let references: unknown[] = [];
  try { references = validateJsonResponse(refResponse.content, ReferenceSchema); } catch (e) { logger.warn('Reference extraction failed', { error: String(e) }); }

  const qualityScore = Math.min(1, (
    ((arguments_ as unknown[]).length / 10) * 0.3 +
    ((quotes as unknown[]).length / 5) * 0.2 +
    ((references as Array<{ url?: string }>).filter((r) => typeof r.url === 'string' && r.url.startsWith('http')).length / 5) * 0.3 +
    ((topics as unknown[]).length / 5) * 0.2
  ));

  // Write Analysis JSON (backward compatible) — upsert for re-submit safety
  let analysisId: string | null = null;
  if (episodeId) {
    const analysis = await prisma.analysis.upsert({
      where: { episodeId },
      create: {
        episodeId,
        arguments: toPrismaJson(arguments_) as never,
        speakers: toPrismaJson(speakers) as never,
        topics: toPrismaJson(topics) as never,
        quotes: toPrismaJson(quotes) as never,
        summary: toPrismaJson(summaryJson || { summary: '', takeaways: [], language: 'zh' }) as never,
        qualityScore,
        references: {
          create: (references as Array<{ url: string; title: string; description: string; relevanceScore: number }>).map((ref) => ({
            url: ref.url,
            title: ref.title,
            description: ref.description,
            relevanceScore: ref.relevanceScore,
          })),
        },
      },
      update: {
        arguments: toPrismaJson(arguments_) as never,
        speakers: toPrismaJson(speakers) as never,
        topics: toPrismaJson(topics) as never,
        quotes: toPrismaJson(quotes) as never,
        summary: toPrismaJson(summaryJson || { summary: '', takeaways: [], language: 'zh' }) as never,
        qualityScore,
      },
    });
    // Delete old references and recreate
    await prisma.referenceLink.deleteMany({ where: { analysisId: analysis.id } });
    await prisma.referenceLink.createMany({
      data: (references as Array<{ url: string; title: string; description: string; relevanceScore: number }>).map((ref) => ({
        analysisId: analysis.id,
        url: ref.url,
        title: ref.title,
        description: ref.description,
        relevanceScore: ref.relevanceScore,
      })),
    });
    analysisId = analysis.id;
  }

  // Phase 1: Sync ThoughtUnits + EvidenceSpans
  if (conversationId) {
    const sourceAnalysisId = analysisId;
    await syncThoughtUnitsFromAnalysis(
      conversationId,
      sourceAnalysisId,
      arguments_ as Array<{ id: string; text: string; speakerId: string; type: string; timestamp: number }>,
      quotes as Array<{ id: string; text: string; speakerId: string; timestamp: number; context: string }>,
    );

    // Phase 4: Generate embeddings for semantic search (best-effort)
    await generateThoughtUnitEmbeddings(conversationId).catch((err) => {
      logger.warn(`Embedding generation failed for conversation ${conversationId}`, { error: String(err) });
    });
  }

  return { arguments_, speakers, topics, quotes, references };
}

async function findConversationId(episodeId: string): Promise<string | undefined> {
  const conversation = await prisma.conversation.findFirst({
    where: { episodeId },
    select: { id: true },
  });
  return conversation?.id;
}

async function updateConversationStatusForConversation(conversationId: string, status: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status },
  }).catch(() => {});
}

async function syncConversationFromAnalysis(
  conversationId: string,
  speakers: Array<{ id: string; name: string; role?: string }>,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return;

  await prisma.participant.deleteMany({ where: { conversationId: conversation.id } });

  if (speakers.length > 0) {
    await prisma.participant.createMany({
      data: speakers.map((speaker) => ({
        conversationId: conversation.id,
        name: speaker.name,
        role: speaker.role ?? null,
        speakerLabel: speaker.id,
        isResolved: true,
        confidence: 1.0,
      })),
    });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: 'completed' },
  });

  await rebuildCorpusGraph(conversation.corpusId).catch((err) => {
    logger.warn(`Graph rebuild failed for corpus ${conversation.corpusId}`, { error: String(err) });
  });

  logger.info(`Synced ${speakers.length} participants for conversation ${conversation.id}`);
}

async function syncThoughtUnitsFromAnalysis(
  conversationId: string,
  analysisId: string | null,
  arguments_: Array<{ id: string; text: string; speakerId: string; type: string; timestamp: number }>,
  quotes: Array<{ id: string; text: string; speakerId: string; timestamp: number; context: string }>,
): Promise<void> {
  const modelName = 'claude-3-5-sonnet-20241022';

  await prisma.thoughtUnit.deleteMany({ where: { conversationId } });

  const turns = await prisma.turn.findMany({
    where: { conversationId },
    orderBy: { turnIndex: 'asc' },
  });

  const typeMap: Record<string, string> = {
    claim: 'claim',
    support: 'evidence',
    oppose: 'objection',
    refine: 'insight',
  };

  for (const arg of arguments_) {
    const tu = await prisma.thoughtUnit.create({
      data: {
        conversationId,
        type: typeMap[arg.type] || 'claim',
        text: arg.text,
        confidence: 0.8,
        createdByModel: modelName,
        extractionVersion: '1.0.0',
        sourceAnalysisId: analysisId ?? null,
      },
    });

    const nearTurn = turns.find(
      (t) => Math.abs(t.startMs - arg.timestamp * 1000) < 10000,
    );

    await prisma.evidenceSpan.create({
      data: {
        thoughtUnitId: tu.id,
        turnId: nearTurn?.id ?? null,
        startMs: Math.max(0, arg.timestamp * 1000 - 2000),
        endMs: arg.timestamp * 1000 + 5000,
        quote: arg.text.slice(0, 200),
        confidence: 0.8,
      },
    });
  }

  for (const quote of quotes) {
    const tu = await prisma.thoughtUnit.create({
      data: {
        conversationId,
        type: 'evidence',
        text: `"${quote.text}" — ${quote.context}`,
        confidence: 0.9,
        createdByModel: modelName,
        extractionVersion: '1.0.0',
        sourceAnalysisId: analysisId ?? null,
      },
    });

    await prisma.evidenceSpan.create({
      data: {
        thoughtUnitId: tu.id,
        turnId: null,
        startMs: Math.max(0, quote.timestamp * 1000 - 2000),
        endMs: quote.timestamp * 1000 + 3000,
        quote: quote.text,
        confidence: 0.9,
      },
    });
  }

  logger.info(
    `Synced ${arguments_.length} argument-thoughts + ${quotes.length} quote-thoughts for conversation ${conversationId}`,
  );
}

/**
 * Phase 4: Generate vector embeddings for all thought units in a conversation.
 * Best-effort — failures are logged but do not block the pipeline.
 */
async function generateThoughtUnitEmbeddings(conversationId: string): Promise<void> {
  const thoughtUnits = await prisma.thoughtUnit.findMany({
    where: { conversationId },
    select: { id: true, text: true },
  });

  if (thoughtUnits.length === 0) return;

  // Build text inputs: type-specific prefixes improve search quality
  const texts = thoughtUnits.map((tu) => tu.text);

  // Batch generate embeddings
  const vectors = await generateEmbeddings(texts);

  // Batch store all embeddings
  const entries = thoughtUnits.map((tu, i) => ({
    resourceType: 'thought_unit',
    resourceId: tu.id,
    vector: vectors[i],
    model: 'text-embedding-3-small',
  }));

  await storeEmbeddings(entries);

  logger.info(`Generated ${thoughtUnits.length} embeddings for conversation ${conversationId}`);
}
