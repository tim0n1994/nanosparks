/**
 * GET /api/conversations/:id/progress (SSE)
 *
 * Staged processing progress for the reader's "first minute" experience
 * (PRD §2.3 第一分钟). Streams human-language stage transitions:
 *   排队中 → 下载中 → 转写中 → 整理说话人 → 生成导读 → 可读
 *
 * The reader opens reading as soon as the stage reaches "ready" (transcribed),
 * even before brief/quotes finish (PRD: 转写完成即先读).
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { statusToStage } from '@/lib/progress-stages';

export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 3000;
const MAX_DURATION_MS = 30 * 60 * 1000; // 30 min ceiling

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const startedAt = Date.now();
      let lastStage = '';

      const tick = async () => {
        try {
          const conv = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { status: true },
          });
          if (!conv) {
            send('error', { message: 'Conversation not found' });
            controller.close();
            return;
          }
          const stage = statusToStage(conv.status);
          if (stage.stage !== lastStage) {
            lastStage = stage.stage;
            send('stage', stage);
            if (stage.stage === 'ready' || stage.stage === 'failed') {
              controller.close();
              return;
            }
          }
        } catch (err) {
          send('error', { message: String(err) });
          controller.close();
          return;
        }

        if (Date.now() - startedAt > MAX_DURATION_MS) {
          send('error', { message: 'progress stream timed out' });
          controller.close();
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      };

      // Respect client disconnect.
      request.signal.addEventListener('abort', () => {
        try { controller.close(); } catch { /* already closed */ }
      });

      void tick();
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
