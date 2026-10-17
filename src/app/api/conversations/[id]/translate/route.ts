/**
 * POST /api/conversations/:id/translate — 双语对照翻译（基础功能，不限额）.
 *
 * Uses the 'translation' module LLM profile (user can pick Gemini for speed).
 * If auto-translate already ran in the analyze job, this is a no-op.
 *
 * Body: { target: 'zh' | 'en' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireConversationAccess } from '@/lib/auth/conversation-access';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';
import { getLlmSettingsForModule } from '@/lib/settings';
import { translateEpisodeTurns, type TranslationTarget } from '@/lib/transcription/translation';
import { logger } from '@/lib/logger';

const bodySchema = z.object({ target: z.enum(['zh', 'en']) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;

  const access = await requireConversationAccess(conversationId, 'write');
  if ('response' in access) return access.response;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }
  const target = parsed.data.target as TranslationTarget;

  const turns = await prisma.turn.findMany({
    where: { conversationId },
    select: { id: true, turnIndex: true, text: true, translationJson: true },
    orderBy: { turnIndex: 'asc' },
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

  // Check if already fully translated.
  const hasTodo = turns.some((t) => !existing.get(t.id)?.[target]);
  if (!hasTodo) {
    return NextResponse.json({ success: true, message: 'Already translated', translatedCount: 0 });
  }

  // Use the translation module profile (user can pick Gemini for speed in settings).
  const tSettings = await getLlmSettingsForModule('translation');
  const client = tSettings.apiFormat === 'anthropic'
    ? new ClaudeClient(tSettings.apiKey, tSettings.model, tSettings.baseUrl)
    : new OpenAIClient(tSettings.apiKey, tSettings.model, tSettings.baseUrl);

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

    return NextResponse.json({
      success: true,
      translatedCount: result.translatedCount,
      costUsd: result.costUsd,
    });
  } catch (err) {
    logger.error('Translation failed', { conversationId, error: String(err) });
    return NextResponse.json(
      { success: false, error: `Translation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
