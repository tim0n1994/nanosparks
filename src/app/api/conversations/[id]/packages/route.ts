/**
 * POST /api/conversations/:id/packages
 *
 * Generates the 一鱼多吃 content pack (B1) for a conversation: builds copy for
 * every platform+variant in the matrix, runs the sensitive-word filter, and
 * persists one PublishPackage per entry. Returns the package summaries so the UI
 * can render them with hits + declaration guidance.
 *
 * GET returns the existing packages for the conversation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { OpenAIClient } from '@/lib/llm/client';
import { getRoutedLlmSettings } from '@/lib/extraction/model-router';
import { getConsentStatusForConversation } from '@/lib/extraction/model-router';
import { buildPublishPackages } from '@/lib/publish/package-builder';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { logger } from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const packages = await prisma.publishPackage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, platform: true, variant: true, copyText: true,
      status: true, publishedUrl: true, costUsd: true, sensitiveHits: true, createdAt: true,
    },
  });
  return NextResponse.json({ success: true, packages });
}

export async function POST(
  _request: NextRequest,
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

  // Load conversation + quotes/key-points for the copy prompts.
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, title: true, language: true,
      source: { select: { uri: true, platform: true } },
      globalEpisode: { select: { showTitle: true } },
    },
  });
  if (!conversation) {
    return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
  }

  const [quotes, keyPoints] = await Promise.all([
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: 'insight' },
      orderBy: [{ confidence: 'desc' }],
      take: 6,
      select: { id: true, text: true },
    }),
    prisma.thoughtUnit.findMany({
      where: { conversationId, type: { in: ['insight', 'decision'] } },
      orderBy: [{ confidence: 'desc' }],
      take: 6,
      select: { id: true, text: true },
    }),
  ]);

  const consentStatus = await getConsentStatusForConversation(conversationId);
  const routed = await getRoutedLlmSettings(consentStatus);
  const client = new OpenAIClient(routed.apiKey, routed.model, routed.baseUrl);

  try {
    const packages = await buildPublishPackages(
      {
        conversationId,
        userId,
        episodeTitle: conversation.title ?? '未命名',
        showTitle: conversation.globalEpisode?.showTitle ?? undefined,
        quotes,
        keyPoints,
        sourceUrl: conversation.source?.uri ?? undefined,
      },
      client,
    );
    logger.info('publish packages built', { conversationId, count: packages.length });
    return NextResponse.json({ success: true, packages });
  } catch (err) {
    logger.error('publish package build failed', { conversationId, error: String(err) });
    return NextResponse.json({ success: false, error: 'Package generation failed' }, { status: 500 });
  }
}
