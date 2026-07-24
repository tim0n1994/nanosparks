/**
 * POST /api/person/:id/chat  (SSE)
 *
 * V3/T-V3-5: persona chat. Returns 403 when the person's chatEnabled is false
 * (the hard gate). Otherwise streams the grounded, citation-verified answer.
 * Every response carries the mandatory "AI simulated, not the real person"
 * disclosure as the first SSE event.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { personaAnswer } from '@/lib/person/persona-chat';
import { logger } from '@/lib/logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: entityId } = await params;
  let body: { question?: string; corpusId?: string; participantId?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const question = (body.question ?? '').trim();
  const corpusId = body.corpusId ?? '';
  if (!question) {
    return NextResponse.json({ success: false, error: 'question is required' }, { status: 400 });
  }

  // Hard gate: chatEnabled must be true.
  const profile = await prisma.personProfile.findUnique({
    where: { entityId },
    select: { chatEnabled: true, entity: { select: { canonicalName: true } } },
  });
  if (!profile || !profile.chatEnabled) {
    return NextResponse.json(
      { success: false, error: '该人物尚未开放对话（出场集数不足或属于敏感人物）。' },
      { status: 403 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // Mandatory disclosure first.
      send('disclosure', { text: `AI 根据 ${profile.entity.canonicalName} 的公开播客发言模拟，非本人，观点以原音频为准。` });

      try {
        const result = await personaAnswer(entityId, question, { corpusId, participantId: body.participantId });
        send('result', result);
      } catch (error) {
        logger.error('Persona chat failed', { entityId, error: String(error) });
        send('error', { message: String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
