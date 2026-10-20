import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queues: new Map<string, Record<string, unknown>>(), addFlow: vi.fn() }));
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string, options: Record<string, unknown>) { mocks.queues.set(name, options); }
  },
  FlowProducer: class { add = mocks.addFlow; },
}));
vi.mock('@/lib/redis', () => ({ redisConnection: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn() } }));

import '@/lib/queue/config';
import { addProcessingFlow } from '@/lib/queue/flow';

describe('pipeline queue policy', () => {
  it('bounds retention for every queue without replaying non-idempotent stages', () => {
    expect(mocks.queues.size).toBe(9); // 8 pipeline queues + embed (2026-10-19)
    for (const [name, options] of mocks.queues) {
      expect(options.defaultJobOptions).toEqual(expect.objectContaining({
        attempts: name === 'normalize_turns' ? 3 : 1,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 86_400, count: 1000 },
        removeOnFail: { age: 604_800, count: 1000 },
      }));
    }
  });

  it('applies the same policy to FlowProducer nodes and propagates permanent child failure', async () => {
    mocks.addFlow.mockResolvedValue({ job: { id: 'root' } });
    await addProcessingFlow({ sourceId: 's', conversationId: 'c', mediaPath: '/tmp/test.mp3' });
    const root = mocks.addFlow.mock.calls[0][0];
    const normalize = root.children[0];
    for (const node of [root, normalize, ...normalize.children]) {
      expect(node.opts).toEqual(expect.objectContaining(mocks.queues.get(node.queueName)?.defaultJobOptions));
      if (node !== root) expect(node.opts.failParentOnFailure).toBe(true);
    }
    expect(normalize.opts.attempts).toBe(3);
  });

  it('keeps initial IDs compatible and deduplicates only within the same retry run', async () => {
    mocks.addFlow.mockClear();
    mocks.addFlow.mockResolvedValue({ job: { id: 'root' } });
    for (const processingRunId of [undefined, 'retry-one', 'retry-two', 'retry-one']) {
      await addProcessingFlow({ sourceId: 'source', conversationId: 'conversation', processingRunId });
    }
    const ids = mocks.addFlow.mock.calls.map(([root]) => [root, root.children[0], ...root.children[0].children]
      .map((node) => node.opts.jobId));
    expect(ids[0]).toEqual(['source-extract', 'source-normalize', 'source-transcribe', 'source-diarize']);
    expect(ids[1]).toEqual(['source-retry-one-extract', 'source-retry-one-normalize', 'source-retry-one-transcribe', 'source-retry-one-diarize']);
    expect(ids[2].every((id: string) => id.includes('retry-two'))).toBe(true);
    expect(ids[3]).toEqual(ids[1]);
  });
});
