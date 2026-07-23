/**
 * POST /api/conversations/:id/translate — PRD §A3 双语对照按需翻译.
 *
 * Triggers on-demand translation of an episode's turns into the target language.
 * Per PRD §A3/§7: 按需触发计一次额度（only consumes quota on first translation;
 * already-translated episodes are free re-reads via the shared cache).
 *
 * Body: { target: 'zh' | 'en' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { getRoutedLlmSettings, getConsentStatusForConversation } from '@/lib/extraction/model-router';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { translateEpisodeTurns, type TranslationTarget } from '@/lib/transcription/translation';
import { getMonthlyQuotaStatus, canTranscribeFromCounts } from '@/lib/quota';
import { logger } from '@/lib/logger';

const bodySchema = z.object({ target: z.enum(['zh', 'en']) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;

  let userId = 'dev-user';
  if (isValidClerkKey) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    userId = clerkUserId;
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }
  const target = parsed.data.target as TranslationTarget;

  const turns = await prisma.turn.findMany({
    where: { conversationId },
    orderBy: { turnIndex: 'asc' },
    select: { id: true, turnIndex: true, text: true, translationJson: true },
  });

  if (turns.length === 0) {
    return NextResponse.json({ success: false, error: 'No turns to translate' }, { status: 404 });
  }

  // Build the existing-translation map per turn.
  const existing = new Map<string, Record<string, string>>();
  for (const t of turns) {
    if (t.translationJson && typeof t.translationJson === 'object') {
      existing.set(t.id, t.translationJson as Record<string, string>);
    }
  }

  // Quota: only charge if there is actual work to do (PRD: 按需触发计一次额度).
  const hasTodo = turns.some((t) => !existing.get(t.id)?.[target]);
  if (hasTodo) {
    const quota = await getMonthlyQuotaStatus(userId);
    if (!quota.canTranscribe) {
      return NextResponse.json(
        { success: false, error: '本月额度已用完，翻译需消耗一次额度。', kind: 'quota_exhausted', quota },
        { status: 429 },
      );
    }
  }

  const consentStatus = await getConsentStatusForConversation(conversationId);
  const routed = await getRoutedLlmSettings(consentStatus);
  // Pick the client matching the API format — CCR (anthropic) only serves
  // /v1/messages, so OpenAIClient (which hits /chat/completions) 404s there.
  const client = routed.apiFormat === 'anthropic'
    ? new ClaudeClient(routed.apiKey, routed.model, routed.baseUrl)
    : new OpenAIClient(routed.apiKey, routed.model, routed.baseUrl);

  try {
    const result = await translateEpisodeTurns({
      conversationId,
      target,
      turns: turns.map((t) => ({ turnId: t.id, turnIndex: t.turnIndex, text: t.text })),
      existing,
      client,
      persist: async (updates) => {
        for (const u of updates) {
          await prisma.turn.update({
            where: { id: u.turnId },
            data: { translationJson: u.translationJson },
          });
        }
      },
    });

    // PRD §A2: record translation cost on the conversation's latest ExtractionRun
    // so §9 cost metrics (getCostMetrics) include translation spend.
    if (result.costUsd > 0) {
      const latestRun = await prisma.extractionRun.findFirst({
        where: { conversationId },
        orderBy: { startedAt: 'desc' },
        select: { id: true, costUsd: true },
      });
      if (latestRun) {
        await prisma.extractionRun.update({
          where: { id: latestRun.id },
          data: { costUsd: (latestRun.costUsd ?? 0) + result.costUsd },
        });
      }
    }

    logger.info('on-demand translation done', { conversationId, target, ...result });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    logger.error('on-demand translation failed', { conversationId, error: String(err) });
    return NextResponse.json({ success: false, error: 'Translation failed' }, { status: 500 });
  }
}
