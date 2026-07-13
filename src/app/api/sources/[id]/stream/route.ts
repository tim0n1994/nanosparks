/**
 * GET /api/sources/:id/stream (SSE)
 *
 * Server-Sent Events stream for real-time processing progress.
 * Replaces polling the status endpoint.
 *
 * Events:
 *   - status: { status, progress } — processing status update
 *   - complete: { result } — processing finished
 *   - error: { message } — processing failed
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redisConnection } from '@/lib/redis';
import { Queue } from 'bullmq';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // Poll source status and stream updates
        let lastStatus = '';
        const interval = setInterval(async () => {
          try {
            const source = await prisma.source.findUnique({
              where: { id: sourceId },
              select: { id: true, status: true },
            });

            if (!source) {
              send('error', { message: 'Source not found' });
              clearInterval(interval);
              controller.close();
              return;
            }

            if (source.status !== lastStatus) {
              lastStatus = source.status;
              send('status', { status: source.status });

              if (source.status === 'completed') {
                // Get queue stats for completion event
                try {
                  const queue = new Queue('analyze', { connection: redisConnection });
                  const counts = await queue.getJobCounts('completed', 'failed');
                  await queue.close();
                  send('complete', { result: { status: 'completed', jobsCompleted: counts.completed } });
                } catch {
                  send('complete', { result: { status: 'completed' } });
                }
                clearInterval(interval);
                controller.close();
              } else if (source.status === 'failed') {
                send('error', { message: 'Processing failed' });
                clearInterval(interval);
                controller.close();
              }
            }
          } catch {
            // Connection errors are non-fatal for polling
          }
        }, 2000);

        // Clean up on abort
        request.signal.addEventListener('abort', () => {
          clearInterval(interval);
          controller.close();
        });
      } catch (error) {
        send('error', { message: String(error) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
