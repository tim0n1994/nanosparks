/**
 * Analyze Job (v2 — ExtractionRun + windowed extraction + model routing)
 *
 * Supports two paths:
 * 1. Episode-based (legacy YouTube): { episodeId } — reads transcript from Episode.transcript
 * 2. Conversation-only (upload/transcript): { conversationId } — reads turns from Turn table
 *
 * v2 changes:
 * - Creates an ExtractionRun record for every extraction (replayable, comparable)
 * - Uses windowed extraction (createWindows → extractFromWindow → mergeExtractions)
 *   instead of "整篇 transcript 一把梭"
 * - Uses model routing: sensitive→local, public→cloud
 * - ThoughtUnits are linked to runId
 * - Legacy Analysis JSON still written for backward compatibility
 */

import { prisma } from '@/lib/prisma';
import { OpenAIClient, validateJsonResponse } from '@/lib/llm/client';
import { ClaudeClient } from '@/lib/llm/client';
import { attachSecondaryFromSettings } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { getRoutedLlmSettings, getConsentStatusForConversation } from '@/lib/extraction/model-router';
import { createWindows, extractFromWindow, mergeExtractions } from '@/lib/extraction/windowed-extraction';
import { ARGUMENT_EXTRACTION_PROMPT } from '@/lib/llm/prompts/argument-extraction';
import { SPEAKER_IDENTIFICATION_PROMPT } from '@/lib/llm/prompts/speaker-identification';
import { SPEAKER_ASSIGNMENT_PROMPT } from '@/lib/llm/prompts/speaker-assignment';
import { TOPIC_EXTRACTION_PROMPT } from '@/lib/llm/prompts/topic-extraction';
import { QUOTE_EXTRACTION_PROMPT } from '@/lib/llm/prompts/quote-extraction';
import { REFERENCE_GENERATION_PROMPT } from '@/lib/llm/prompts/reference-generation';
import { SUMMARY_GENERATION_PROMPT } from '@/lib/llm/prompts/summary-generation';
import { logger } from '@/lib/logger';
import { toPrismaJson } from '@/lib/prisma-json';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { updateConversationStatus } from '@/lib/adapters/episode-to-conversation';
import { rebuildCorpusGraph } from '@/lib/graph/builder';
import { runDistillationForConversation } from '@/lib/person/distillation-pipeline';
import { mergeConversationIntoGraph } from '@/lib/graph/incremental';
import { buildCanonicalClaims } from '@/lib/graph/canonical-claim';
import { projectCorpus } from '@/lib/embeddings/projection';
import { buildPersonProfile } from '@/lib/person/profile-builder';
import { generateEmbeddings } from '@/lib/embeddings';
import { storeEmbeddings } from '@/lib/embeddings/search';
import { mapSpeakerNames } from '@/lib/transcription/speaker-mapper';
import { runCorrectionPass } from '@/lib/transcription/correction-pass';
import { growShowGlossary, extractGlossaryCandidates } from '@/lib/transcription/hotwords';
import { loadShowGlossary } from '@/lib/transcription/hotwords';
import { costBreakerTripped } from '@/lib/guardrails';
import { ensurePublicSlug } from '@/lib/public-slug';
import { resolveParticipant, normalizeStance } from '@/lib/extraction/attribution';
import { persistConversationEntities } from '@/lib/entity/resolver';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';

interface AnalyzeJobData {
  episodeId?: string;
  conversationId?: string;
  sourceId?: string;
  /** ExtractionRun ID (from re-extract API); if absent, a new run is created */
  extractionRunId?: string;
}

const ArgumentSchema = z.array(z.object({
  id: z.string(),
  text: z.string(),
  speakerId: z.string(),
  type: z.enum(['claim', 'support', 'oppose', 'refine']),
  parentId: z.string().nullable(),
  timestamp: z.number(),
}));

// `role` is optional: some speaker-identification models omit it, which would
// otherwise fail the whole array parse → empty speakers → assignTurnSpeakers
// skipped → all turns left with null participantId.
const SpeakerSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional().default(''),
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

/**
 * Race a best-effort stage against a hard timeout. The analyze tail (entity
 * resolution, legacy extraction, TU embeddings) calls the LLM/embedding endpoint
 * repeatedly; a single hung router connection that ignores abort can stall the
 * whole job forever. This guarantees the stage resolves (rejects) within `ms`
 * so the job can move on — these stages are all value-add, not load-bearing.
 */
async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } catch (err) {
    logger.warn(`${label} failed (best-effort, continuing)`, { error: String(err) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function processAnalyzeJob(data: AnalyzeJobData): Promise<void> {
  const { episodeId, conversationId: explicitConversationId, sourceId, extractionRunId } = data;

  if (episodeId) {
    return processEpisodeAnalysis({ episodeId, conversationId: explicitConversationId, extractionRunId });
  }

  if (explicitConversationId) {
    return processConversationAnalysis({ conversationId: explicitConversationId, sourceId, extractionRunId });
  }

  throw new Error('Analyze job requires either episodeId or conversationId');
}

/**
 * Episode-based analysis (legacy YouTube flow).
 */
async function processEpisodeAnalysis(data: { episodeId: string; conversationId?: string; extractionRunId?: string }): Promise<void> {
  const { episodeId, extractionRunId } = data;
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

    // ── Model routing: determine consent status and get routed settings ──
    const consentStatus = conversationId
      ? await getConsentStatusForConversation(conversationId)
      : 'unknown';
    const routedSettings = await getRoutedLlmSettings(consentStatus);
    const client = routedSettings.apiFormat === 'anthropic'
      ? new ClaudeClient(routedSettings.apiKey, routedSettings.model, routedSettings.baseUrl)
      : new OpenAIClient(routedSettings.apiKey, routedSettings.model, routedSettings.baseUrl);
    // Attach the secondary endpoint (if configured) for round-robin load balancing
    // across both LLM endpoints — doubles extraction throughput when two are set.
    await attachSecondaryFromSettings(client);

    // ── Create or fetch ExtractionRun ──
    const run = await getOrCreateExtractionRun({
      runId: extractionRunId,
      conversationId,
      corpusId: conversationId ? (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { corpusId: true } }))?.corpusId : undefined,
      model: routedSettings.model,
      tier: routedSettings.tier,
    });

    const { arguments_, speakers, quotes } = await runLlmExtraction(client, transcriptText, episodeId, conversationId, run.id);

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
      const turnAssignments = await assignTurnSpeakers(
        client,
        conversationId,
        (speakers as Array<{ id: string; name: string }>).map((s) => ({ id: s.id, name: s.name })),
      );
      await syncConversationFromAnalysis(
        conversationId,
        speakers as Array<{ id: string; name: string; role?: string }>,
        turnAssignments,
      );

      // P-post: run the L0->L3 distillation chain. Non-fatal.
      await runDistillationForConversation(conversationId, { client }).catch(() => {});
   }

   // ── Mark ExtractionRun as completed and active ──
   await completeExtractionRun(run.id);

    logger.info(`Analysis completed for episode ${episodeId}`, {
      args: (arguments_ as unknown[]).length,
      conversationId,
      runId: run.id,
    });
  } catch (error) {
    logger.error(`Episode analyze job failed for ${episodeId}`, { error: String(error) });
    await prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'FAILED' },
    }).catch(() => {});
    if (extractionRunId) {
      await failExtractionRun(extractionRunId);
    }
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
async function processConversationAnalysis(data: { conversationId: string; sourceId?: string; extractionRunId?: string }): Promise<void> {
  const { conversationId, sourceId, extractionRunId } = data;
  // Correction-pass cost accrues onto the ExtractionRun (PRD §A2 成本打点).
  let correctionCostUsd = 0;

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

    // ── Model routing: determine consent status and get routed settings ──
    const consentStatus = await getConsentStatusForConversation(conversationId);
    const routedSettings = await getRoutedLlmSettings(consentStatus);
    const client = routedSettings.apiFormat === 'anthropic'
      ? new ClaudeClient(routedSettings.apiKey, routedSettings.model, routedSettings.baseUrl)
      : new OpenAIClient(routedSettings.apiKey, routedSettings.model, routedSettings.baseUrl);
    await attachSecondaryFromSettings(client);

    // ── LLM correction pass (PRD §A2): runs BEFORE extraction. Terminology-dictionary
    // correction + filler-word compression + mixed-language normalization. Persists
    // corrected text back to Turn.text without touching timestamps. Best-effort:
    // a failure degrades to the raw transcript rather than blocking the pipeline.
    try {
      // Load the show-level hot-word glossary (PRD §A2 热词 API 挂节目级术语词典).
      const episodeMeta = await prisma.conversation
        .findUnique({
          where: { id: conversationId },
          select: {
            title: true,
            globalEpisode: { select: { showTitle: true, description: true } },
          },
        });
      const showTitle = episodeMeta?.globalEpisode?.showTitle ?? null;
      const glossary = await loadShowGlossary(showTitle);
      const { outputs: corrected, costUsd } = await runCorrectionPass(
        turns.map((t) => ({
          turnIndex: t.turnIndex,
          speakerLabel: t.participant?.name ?? null,
          text: t.text,
        })),
        client,
        glossary,
        {
          title: episodeMeta?.title,
          showTitle,
          description: episodeMeta?.globalEpisode?.description,
        },
      );
      correctionCostUsd = costUsd;
      for (const c of corrected) {
        if (c.corrections > 0) {
          const orig = turns[c.turnIndex];
          // §5.5: 校正可回溯 —— 保留原始 ASR 文本为 rawText，校正作为 overlay。
          // 只在 rawText 尚未保存时写入（避免回填覆盖已存原文）。
          await prisma.turn.update({
            where: { id: orig?.id },
            data: { text: c.text, rawText: orig?.text ?? undefined },
          });
        }
      }
      // §5.5: 术语表自动生长 —— 高置信专名回写节目级 glossary，下集校正更准（infra 复利）。
      const candidates = extractGlossaryCandidates(corrected.map((c) => c.text));
      await growShowGlossary(showTitle, candidates).catch((e) => {
        logger.warn('Glossary auto-growth failed', { conversationId, error: String(e) });
      });
      logger.info('Correction pass applied', { conversationId, corrected: corrected.filter((c) => c.corrections > 0).length, costUsd });
    } catch (e) {
      logger.warn('Correction pass failed, continuing with raw transcript', { conversationId, error: String(e) });
    }

    // ── Create or fetch ExtractionRun ──
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { corpusId: true },
    });
    const run = await getOrCreateExtractionRun({
      runId: extractionRunId,
      conversationId,
      corpusId: conversation?.corpusId,
      model: routedSettings.model,
      tier: routedSettings.tier,
    });
    // Accrue correction-pass cost onto the run (PRD §A2 成本打点进 ExtractionRun.costUsd).
    if (correctionCostUsd > 0) {
      await prisma.extractionRun.update({
        where: { id: run.id },
        data: { costUsd: (run.costUsd ?? 0) + correctionCostUsd },
      });
    }

    // ── Windowed extraction: split → per-window extract → merge ──
    const turnLikes = turns.map((t) => ({
      turnIndex: t.turnIndex,
      startMs: t.startMs,
      endMs: t.endMs,
      text: t.text,
      speakerLabel: t.participant?.name ?? undefined,
    }));

    const windows = createWindows(turnLikes);
    logger.info('Windowed extraction started', {
      conversationId,
      windows: windows.length,
      runId: run.id,
      tier: routedSettings.tier,
    });

    // Per-window guard: a single hung structured-output call (the glm router
    // occasionally stalls on ARGUMENT_EXTRACTION and the in-fetch 5m abort is
    // not always honored) must not block the whole 440-window loop. Race each
    // window against a hard ceiling; on timeout skip the window and continue.
    const WINDOW_TIMEOUT_MS = 90_000;
    const windowResults = [];
    for (const window of windows) {
      try {
        const result = await new Promise< Awaited<ReturnType<typeof extractFromWindow>> >((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`window extraction timed out after ${WINDOW_TIMEOUT_MS}ms`)),
            WINDOW_TIMEOUT_MS,
          );
          extractFromWindow(client, window).then(
            (r) => { clearTimeout(timer); resolve(r); },
            (e) => { clearTimeout(timer); reject(e); },
          );
        });
        windowResults.push(result);
      } catch (e) {
        logger.warn('Window extraction failed', { windowIndex: window.index, error: String(e) });
      }
    }

    const merged = mergeExtractions(windowResults);
    logger.info('Windowed extraction merged', {
      conversationId,
      mergedTUs: merged.thoughtUnits.length,
      relations: merged.relations.length,
      runId: run.id,
    });

    // ── Write ThoughtUnits from merged extraction (linked to runId) ──
    await syncThoughtUnitsFromWindowedExtraction(conversationId, run.id, merged, turns);

    // ── V2/T-V2-2: resolve + persist window entities (folded into the same
    // extraction call, so no extra LLM cost). Entities are workspace-scoped.
    const allEntities = windowResults.flatMap((w) => w.entities ?? []);
    if (allEntities.length > 0) {
      const corpusWithWs = await prisma.corpus.findUnique({
        where: { id: conversation?.corpusId ?? '' },
        select: { workspaceId: true },
      });
     if (corpusWithWs?.workspaceId) {
        await withTimeout('persist-conversation-entities', 120_000, () =>
          persistConversationEntities(corpusWithWs.workspaceId!, conversationId, allEntities, { client }),
        );
      }
    }

    // Also run legacy extraction for backward-compatible Analysis JSON
    // (speakers, topics, quotes, summary, references)
    const transcriptText = sanitizeForPrompt(
      turns.map((t) => `${t.participant?.name ? `[${t.participant.name}] ` : ''}${t.text}`).join('\n')
    );
    await withTimeout('legacy-extraction', 120_000, () =>
      runLegacyExtraction(client, transcriptText, null, conversationId),
    );

    // ── Generate embeddings for ThoughtUnits ──
    await generateThoughtUnitEmbeddings(conversationId).catch((err) => {
      logger.warn(`Embedding generation failed for conversation ${conversationId}`, { error: String(err) });
    });

    // Mark as completed
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'completed' },
    });

    // C1: publish shared-cache episodes to a public page so they become
    // discoverable (SEO). Private uploads never get a slug (PRD §1.4 分层).
    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { isSharedCache: true, title: true, sourceId: true, source: { select: { publicSlug: true } } },
      });
      if (conv?.isSharedCache && conv.sourceId && !conv.source?.publicSlug && conv.source) {
        const slug = await ensurePublicSlug({
          title: conv.title ?? 'episode',
          conversationId,
          existingSlug: conv.source.publicSlug ?? undefined,
        });
        await prisma.source.update({
          where: { id: conv.sourceId },
          data: { publicSlug: slug },
        });
        logger.info('Public slug assigned for shared-cache episode', { conversationId, slug });
        // C1 SEO: proactively push the new public URL to Baidu (no-op if unconfigured).
        const { pushUrlsToBaidu, publicPageUrl } = await import('@/lib/seo/baidu-push');
        await pushUrlsToBaidu([publicPageUrl(slug)]).catch(() => { /* best-effort SEO */ });
        // C1 SEO: also notify Google Search Console (Indexing API, no-op if unconfigured).
        const { pushUrlsToGoogle } = await import('@/lib/seo/google-ping');
        await pushUrlsToGoogle([publicPageUrl(slug)]).catch(() => { /* best-effort SEO */ });
      }
    } catch (err) {
      logger.warn('Public slug assignment failed', { conversationId, error: String(err) });
    }

    if (sourceId) {
      await prisma.source.update({
        where: { id: sourceId },
        data: { status: 'completed' },
      }).catch(() => {});
    }

   // Rebuild corpus insight graph
   if (conversation) {
      // V2/T-V2-4: incremental per-conversation merge (no delete) instead of full
      // corpus rebuild. rebuildCorpusGraph stays available as a monthly recalibration.
      await mergeConversationIntoGraph(conversationId).catch((err) => {
        logger.warn(`Incremental graph merge failed for ${conversationId}`, { error: String(err) });
      });

      // V2/T-V2-5: rebuild CanonicalClaims (density-reduction layer). Feeds the L1
      // graph + Person Hub opinion library. Idempotent per corpus.
      await buildCanonicalClaims(conversation.corpusId).catch((err) => {
        logger.warn(`CanonicalClaim build failed for corpus ${conversation.corpusId}`, { error: String(err) });
      });

     // V2/T-V2-8: re-project the semantic atlas (yesterday's data is fine).
     // Debounced by being best-effort per import; expensive for large corpora.
     await projectCorpus(conversation.corpusId).catch((err) => {
       logger.warn(`Atlas projection failed for corpus ${conversation.corpusId}`, { error: String(err) });
     });

     // V3/T-V3-2: recompute PersonProfiles for any person entities touched by
     // this conversation, so the Person Hub reflects new mentions.
     try {
       const touchedEntities = await prisma.entityMention.findMany({
         where: { conversationId },
         select: { entity: { select: { id: true, type: true } } },
       });
       const personIds = [...new Set(
         touchedEntities.map((m) => m.entity).filter((e) => e.type === 'person').map((e) => e.id),
       )];
       for (const pid of personIds) {
         await buildPersonProfile(pid, { client }).catch((err) => {
           logger.warn(`PersonProfile build failed for ${pid}`, { error: String(err) });
         });
       }
     } catch (err) {
       logger.warn('Person-profile trigger failed', { conversationId, error: String(err) });
     }
      // (project + person-profile are now enqueued to dedicated workers below,
      //  with inline fallbacks when the queue is unavailable in dev.)
      await enqueueGraphJobs(conversation.corpusId, conversationId, client);
    }

    // ── Mark ExtractionRun as completed and active ──
    await completeExtractionRun(run.id);

    // PRD §A4 单集成本熔断 ¥3: if this episode blew past budget, alert + mark the run.
    try {
      const finalRun = await prisma.extractionRun.findUnique({ where: { id: run.id }, select: { costUsd: true } });
      if (finalRun && costBreakerTripped(finalRun.costUsd ?? 0)) {
        logger.error('Cost circuit breaker tripped for episode', { conversationId, runId: run.id, costUsd: finalRun.costUsd });
      }
    } catch (breakerErr) {
      logger.warn('Cost breaker check failed', { error: String(breakerErr) });
    }

    logger.info(`Analysis completed for conversation ${conversationId}`, { runId: run.id });

    // PRD §2.3 等待黑洞: notify the submitting user that processing is complete.
    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { title: true, source: { select: { corpus: { select: { workspace: { select: { clerkId: true } } } } } } },
      });
      const ownerUserId = conv?.source?.corpus?.workspace?.clerkId;
      if (ownerUserId) {
        const { notifyProcessingComplete } = await import('@/lib/notifications');
        await notifyProcessingComplete({ userId: ownerUserId, conversationId, title: conv.title ?? '未命名' });
      }
    } catch (notifErr) {
      logger.warn('completion notification failed', { conversationId, error: String(notifErr) });
    }
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
    if (extractionRunId) {
      await failExtractionRun(extractionRunId);
    }
    throw error;
  }
}

/**
 * Get an existing ExtractionRun by ID, or create a new one.
 */
async function getOrCreateExtractionRun(opts: {
  runId?: string;
  conversationId?: string;
  corpusId?: string;
  model: string;
  tier: string;
}) {
  if (opts.runId) {
    const existing = await prisma.extractionRun.findUnique({ where: { id: opts.runId } });
    if (existing) {
      await prisma.extractionRun.update({
        where: { id: opts.runId },
        data: { status: 'running', startedAt: new Date() },
      });
      return existing;
    }
  }

  return prisma.extractionRun.create({
    data: {
      conversationId: opts.conversationId,
      corpusId: opts.corpusId,
      kind: 'extract',
      model: opts.model,
      promptVersion: '2.0.0',
      status: 'running',
      params: { tier: opts.tier, windowed: true, structuredOutput: true } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Mark an ExtractionRun as completed and set it as the active run
 * (deactivating previous active runs for the same conversation).
 */
async function completeExtractionRun(runId: string): Promise<void> {
  const run = await prisma.extractionRun.findUnique({ where: { id: runId }, select: { conversationId: true } });

  // Deactivate previous active runs for this conversation
  if (run?.conversationId) {
    await prisma.extractionRun.updateMany({
      where: { conversationId: run.conversationId, isActive: true, id: { not: runId } },
      data: { isActive: false },
    });
  }

  await prisma.extractionRun.update({
    where: { id: runId },
    data: { status: 'completed', finishedAt: new Date(), isActive: true },
  });
}

/**
 * Mark an ExtractionRun as failed.
 */
async function failExtractionRun(runId: string): Promise<void> {
  await prisma.extractionRun.update({
    where: { id: runId },
    data: { status: 'failed', finishedAt: new Date() },
  }).catch(() => {});
}

/**
 * Write ThoughtUnits from the merged windowed extraction result.
 * Each TU is linked to the ExtractionRun via runId.
 */
async function syncThoughtUnitsFromWindowedExtraction(
  conversationId: string,
  runId: string,
  merged: { thoughtUnits: Array<{ type: string; text: string; confidence: number; evidenceSpans: Array<{ startMs: number; endMs: number; quote: string; turnIndex?: number }> }> },
  turns: Array<{ id: string; turnIndex: number; startMs: number }>,
): Promise<void> {
  // Delete old ThoughtUnits from previous runs for this conversation
  await prisma.thoughtUnit.deleteMany({ where: { conversationId } });

  // V1/T-V1-2: resolve each TU's model-emitted speaker label to a Participant.id
  // and normalize its argument stance before writing.
  const participants = await prisma.participant.findMany({
    where: { conversationId },
    select: { id: true, name: true, speakerLabel: true },
  });

  for (const tu of merged.thoughtUnits) {
    const participantId = resolveParticipant(
      (tu as { participantLabel?: string }).participantLabel,
      participants,
    );
    const stance = normalizeStance((tu as { stance?: string }).stance);
    const created = await prisma.thoughtUnit.create({
      data: {
        conversationId,
        type: tu.type,
        text: tu.text,
        confidence: tu.confidence,
        extractionVersion: '2.0.0',
        runId,
        participantId,
        stance,
      },
    });

    for (const es of tu.evidenceSpans) {
      const turn = es.turnIndex !== undefined
        ? turns.find((t) => t.turnIndex === es.turnIndex)
        : turns.find((t) => Math.abs(t.startMs - es.startMs) < 10000);

      await prisma.evidenceSpan.create({
        data: {
          thoughtUnitId: created.id,
          turnId: turn?.id ?? null,
          startMs: es.startMs,
          endMs: es.endMs,
          quote: es.quote.slice(0, 200),
          confidence: tu.confidence,
        },
      });
    }
  }

  logger.info(`Synced ${merged.thoughtUnits.length} thought units from windowed extraction`, {
    conversationId,
    runId,
  });
}

/**
 * Core LLM extraction: runs 5 serial prompts, writes Analysis + ThoughtUnits.
 * Used for episode-based analysis (legacy backward compat).
 */
async function runLlmExtraction(
  client: OpenAIClient,
  transcriptText: string,
  episodeId: string | null,
  conversationId: string | null | undefined,
  runId?: string,
) {
  logger.info('runLlmExtraction start', { transcriptLength: transcriptText.length, runId });

  // Serial LLM calls to avoid upstream rate limits
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

  // Write Analysis JSON (backward compatible)
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

  // Sync ThoughtUnits + EvidenceSpans (linked to runId if available)
  if (conversationId) {
    await syncThoughtUnitsFromAnalysis(
      conversationId,
      analysisId,
      runId,
      arguments_ as Array<{ id: string; text: string; speakerId: string; type: string; timestamp: number }>,
      quotes as Array<{ id: string; text: string; speakerId: string; timestamp: number; context: string }>,
    );

    await generateThoughtUnitEmbeddings(conversationId).catch((err) => {
      logger.warn(`Embedding generation failed for conversation ${conversationId}`, { error: String(err) });
    });
  }

  return { arguments_, speakers, topics, quotes, references };
}

/**
 * Run legacy extraction (speakers, topics, quotes, summary, references)
 * without writing ThoughtUnits — used alongside windowed extraction for
 * backward-compatible Analysis JSON.
 */
async function runLegacyExtraction(
  client: OpenAIClient,
  transcriptText: string,
  episodeId: string | null,
  conversationId: string | null | undefined,
) {
  // Serial LLM calls for backward-compatible Analysis fields
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

  let speakers: unknown[] = [];
  let topics: unknown[] = [];
  let quotes: unknown[] = [];
  let summaryJson: unknown = null;

  try { speakers = validateJsonResponse(speakerResponse.content, SpeakerSchema); } catch (e) { logger.warn('Speaker extraction failed', { error: String(e) }); }
  try { topics = validateJsonResponse(topicResponse.content, TopicSchema); } catch (e) { logger.warn('Topic extraction failed', { error: String(e) }); }
  try { quotes = validateJsonResponse(quoteResponse.content, QuoteSchema); } catch (e) { logger.warn('Quote extraction failed', { error: String(e) }); }
  try { summaryJson = validateJsonResponse(summaryResponse.content, SummarySchema); } catch (e) { logger.warn('Summary extraction failed', { error: String(e) }); }

  // Write Analysis JSON (backward compatible) for episode path
  if (episodeId) {
    const qualityScore = Math.min(1, (
      ((quotes as unknown[]).length / 5) * 0.2 +
      ((topics as unknown[]).length / 5) * 0.2
    ));
    await prisma.analysis.upsert({
      where: { episodeId },
      create: {
        episodeId,
        arguments: toPrismaJson([]) as never,
        speakers: toPrismaJson(speakers) as never,
        topics: toPrismaJson(topics) as never,
        quotes: toPrismaJson(quotes) as never,
        summary: toPrismaJson(summaryJson || { summary: '', takeaways: [], language: 'zh' }) as never,
        qualityScore,
      },
      update: {
        speakers: toPrismaJson(speakers) as never,
        topics: toPrismaJson(topics) as never,
        quotes: toPrismaJson(quotes) as never,
        summary: toPrismaJson(summaryJson || { summary: '', takeaways: [], language: 'zh' }) as never,
        qualityScore,
      },
    });
  }

 // Sync participants from speakers
 if (conversationId && speakers.length > 0) {
    const turnAssignments = await assignTurnSpeakers(
      client,
      conversationId,
      (speakers as Array<{ id: string; name: string }>).map((s) => ({ id: s.id, name: s.name })),
    );
    await syncConversationFromAnalysis(
      conversationId,
      speakers as Array<{ id: string; name: string; role?: string }>,
      turnAssignments,
    );

    // P-post: run the L0->L3 distillation chain (identity -> merge -> claims ->
    // fingerprint) for every person in this conversation. Non-fatal.
    await runDistillationForConversation(conversationId, { client }).catch(() => {});
}
}

async function findConversationId(episodeId: string): Promise<string | undefined> {
  const conversation = await prisma.conversation.findFirst({
    where: { episodeId },
    select: { id: true },
  });
  return conversation?.id;
}

const SpeakerAssignmentSchema = z.array(z.object({
  turnIndex: z.number(),
  speakerId: z.string(),
}));

/**
 * Assign each turn to a speaker when the ASR provider returned no per-segment
 * speaker labels (Qwen3-ASR without diarization). Runs a single LLM call over
 * the turn list (capped for token budget) and returns turnIndex -> speakerId.
 * Best-effort: failures return an empty map and turns stay unattributed.
 */
async function assignTurnSpeakers(
  client: OpenAIClient,
  conversationId: string,
  speakers: Array<{ id: string; name: string }>,
): Promise<Map<number, string>> {
  if (speakers.length === 0) return new Map();
  const turns = await prisma.turn.findMany({
    where: { conversationId },
    orderBy: { turnIndex: 'asc' },
    select: { turnIndex: true, text: true },
  });
  if (turns.length === 0) return new Map();

  // Cap the transcript we send: keep an even sample across the whole episode so
  // the model sees voice continuity rather than only the opening minutes.
  const MAX_CHARS = 18000;
  let selected = turns;
  if (turns.reduce((n, t) => n + t.text.length, 0) > MAX_CHARS) {
    selected = [];
    const step = Math.max(1, Math.floor(turns.length / 120));
    for (let i = 0; i < turns.length && selected.length < 120; i += step) selected.push(turns[i]);
  }
  const turnsBlock = selected
    .map((t) => `{ "turnIndex": ${t.turnIndex}, "text": ${JSON.stringify(t.text.slice(0, 280))} }`)
    .join(',\n');
  const speakersBlock = speakers
    .map((s) => `{ "id": ${JSON.stringify(s.id)}, "name": ${JSON.stringify(s.name)} }`)
    .join(',\n');

  try {
    const response = await client.completeWithRetry([
      { role: 'user', content: SPEAKER_ASSIGNMENT_PROMPT
          .replace('{{speakers}}', `[${speakersBlock}]`)
          .replace('{{turns}}', `[${turnsBlock}]`) },
    ], 4096, 3);
    const assignments = validateJsonResponse(response.content, SpeakerAssignmentSchema);
    const map = new Map<number, string>();
    const validIds = new Set(speakers.map((s) => s.id));
    for (const a of assignments) {
      if (validIds.has(a.speakerId)) map.set(a.turnIndex, a.speakerId);
    }
    logger.info('Turn speaker assignment done', { conversationId, assigned: map.size, sampled: selected.length, total: turns.length });
    return map;
  } catch (error) {
    logger.warn('Turn speaker assignment failed', { error: String(error) });
    return new Map();
  }
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
  turnAssignments?: Map<number, string>,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return;

  // IMPORTANT: Turns reference participants via participantId with onDelete: SetNull.
  // Recreating participants orphans turns, so we rebuild participant rows then
  // re-link every turn. Two paths:
  //  (A) ASR gave per-segment speakers → re-link via old label/name.
  //  (B) No per-segment speakers (Qwen3-ASR) → link via the LLM turnAssignments map.
  const oldParticipants = await prisma.participant.findMany({
    where: { conversationId: conversation.id },
    select: { id: true, speakerLabel: true, name: true },
  });
  const oldById = new Map(oldParticipants.map((p) => [p.id, p]));
  const turnsBefore = await prisma.turn.findMany({
    where: { conversationId: conversation.id },
    select: { id: true, turnIndex: true, participantId: true },
  });
  const turnById = new Map(turnsBefore.map((t) => [t.turnIndex, t]));

  await prisma.participant.deleteMany({ where: { conversationId: conversation.id } });

  // Re-create participants with resolved names; build id->newId and label->newId maps.
  const idToNewId = new Map<string, string>();
  const labelToNewId = new Map<string, string>();
  const nameToNewId = new Map<string, string>();
  for (const speaker of speakers) {
    const created = await prisma.participant.create({
      data: {
        conversationId: conversation.id,
        name: speaker.name,
        role: speaker.role ?? null,
        speakerLabel: speaker.id, // raw label e.g. "s1"
        isResolved: true,
        confidence: 1.0,
      },
    });
    idToNewId.set(speaker.id, created.id);
    if (speaker.id) labelToNewId.set(speaker.id, created.id);
    nameToNewId.set(speaker.name, created.id);
  }

  // Re-link turns. Prefer the explicit per-turn LLM assignment (path B); fall
  // back to old label/name matching (path A) when ASR supplied speaker labels.
  let relinked = 0;
  for (const turn of turnsBefore) {
    let newId: string | undefined;
    const assigned = turnAssignments?.get(turn.turnIndex);
    if (assigned) {
      newId = idToNewId.get(assigned);
    } else if (turn.participantId) {
      const old = oldById.get(turn.participantId);
      newId = old?.speakerLabel ? labelToNewId.get(old.speakerLabel)
        : old?.name ? nameToNewId.get(old.name)
        : undefined;
    }
    if (newId) {
      await prisma.turn.update({ where: { id: turn.id }, data: { participantId: newId } });
      relinked++;
    }
  }
  if (relinked > 0) {
    logger.info(`Re-linked ${relinked} turns to resolved participants`, { conversationId: conversation.id });
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
  runId: string | undefined,
  arguments_: Array<{ id: string; text: string; speakerId: string; type: string; timestamp: number }>,
  quotes: Array<{ id: string; text: string; speakerId: string; timestamp: number; context: string }>,
): Promise<void> {
  const modelName = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  // Only delete TUs that belong to the same run (or have no run) — don't delete
  // TUs from other runs if this is a re-extraction
  if (runId) {
    await prisma.thoughtUnit.deleteMany({ where: { conversationId, runId } });
  } else {
    await prisma.thoughtUnit.deleteMany({ where: { conversationId, runId: null } });
  }

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
        extractionVersion: runId ? '2.0.0' : '1.0.0',
        runId: runId ?? null,
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
        extractionVersion: runId ? '2.0.0' : '1.0.0',
        runId: runId ?? null,
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
    { runId },
  );
}

/**
 * Generate vector embeddings for all thought units in a conversation.
 * Best-effort — failures are logged but do not block the pipeline.
 */
async function generateThoughtUnitEmbeddings(conversationId: string): Promise<void> {
  const thoughtUnits = await prisma.thoughtUnit.findMany({
    where: { conversationId },
    select: { id: true, text: true },
  });

  if (thoughtUnits.length === 0) return;

  const texts = thoughtUnits.map((tu) => tu.text);
  const vectors = await generateEmbeddings(texts);

  const entries = thoughtUnits.map((tu, i) => ({
    resourceType: 'thought_unit',
    resourceId: tu.id,
    vector: vectors[i],
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
  }));

  await storeEmbeddings(entries);

  logger.info(`Generated ${thoughtUnits.length} embeddings for conversation ${conversationId}`);
}

/**
 * V2/V3: enqueue the heavy derived-graph jobs off the import path so a large
 * corpus re-projection never blocks an episode. Falls back to inline execution
 * when the BullMQ queue is unavailable (Redis down in dev / tests).
 * - project (UMAP atlas) → PROJECT_QUEUE, concurrency 1
 * - person-profile rebuild per touched person → PERSON_PROFILE_QUEUE (jobId dedupes)
 */
async function enqueueGraphJobs(
  corpusId: string,
  conversationId: string,
  client: OpenAIClient,
): Promise<void> {
  // 1) Atlas projection.
  try {
    const { projectQueue } = await import('@/lib/queue/config');
    await projectQueue.add('project', { corpusId });
  } catch (e) {
    logger.warn('Atlas projection enqueue failed; running inline', { error: String(e) });
    await projectCorpus(corpusId).catch((err) => {
      logger.warn(`Atlas projection failed for corpus ${corpusId}`, { error: String(err) });
    });
  }

  // 2) Person-profile rebuilds for any person entities mentioned here.
  try {
    const touchedEntities = await prisma.entityMention.findMany({
      where: { conversationId },
      select: { entity: { select: { id: true, type: true } } },
    });
    const personIds = [...new Set(
      touchedEntities.map((m) => m.entity).filter((e) => e.type === 'person').map((e) => e.id),
    )];
    let personProfileQueue: { add: (n: string, d: unknown, o?: { jobId: string }) => Promise<unknown> } | null = null;
    try {
      ({ personProfileQueue } = await import('@/lib/queue/config'));
    } catch {
      personProfileQueue = null;
    }
    for (const pid of personIds) {
      if (personProfileQueue) {
        try {
          await personProfileQueue.add('person-profile', { entityId: pid }, { jobId: `profile:${pid}` });
          continue; // enqueued — skip inline
        } catch (e) {
          logger.warn(`Person-profile enqueue failed for ${pid}; running inline`, { error: String(e) });
        }
      }
      await buildPersonProfile(pid, { client }).catch((err) => {
        logger.warn(`PersonProfile build failed for ${pid}`, { error: String(err) });
      });
    }
  } catch (err) {
    logger.warn('Person-profile trigger failed', { conversationId, error: String(err) });
  }
}
