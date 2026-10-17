// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FlowProducer, Queue, QueueEvents, Worker } from 'bullmq';
import { processingJobId, queueJobOptions } from '@/lib/queue/job-policy';

const redisUrl = process.env.NSP_TEST_REDIS_URL;
const prefix = `nsp-policy-test-${randomUUID()}`;
const queues: Queue[] = [];
const events: QueueEvents[] = [];
const workers: Worker[] = [];
let producer: FlowProducer | undefined;

describe.skipIf(!redisUrl)('queue policy against isolated Redis keys', () => {
  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    await producer?.close();
    await Promise.all(events.map((event) => event.close()));
    for (const queue of queues) {
      if (queue.opts.prefix !== prefix || !prefix.startsWith('nsp-policy-test-')) throw new Error('Refusing cleanup outside test prefix');
      await queue.obliterate();
      const client = await queue.client;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, { MATCH: `${prefix}:${queue.name}:*`, COUNT: 100 });
        expect(keys).toEqual([]);
        cursor = nextCursor;
      } while (cursor !== '0');
      await queue.close();
    }
  });

  it('retries transient failure, bounds permanent failure, and fails dependent parents', async () => {
    const connection = { url: redisUrl!, maxRetriesPerRequest: null };
    const normalize = new Queue('normalize_turns', { connection, prefix, defaultJobOptions: queueJobOptions('normalize_turns') });
    const analyze = new Queue('analyze', { connection, prefix, defaultJobOptions: queueJobOptions('analyze') });
    queues.push(normalize, analyze);
    const normalizeEvents = new QueueEvents('normalize_turns', { connection, prefix });
    const analyzeEvents = new QueueEvents('analyze', { connection, prefix });
    events.push(normalizeEvents, analyzeEvents);
    await Promise.all(events.map((event) => event.waitUntilReady()));

    const calls: Record<string, number> = {};
    const timestamps: Record<string, number[]> = {};
    workers.push(new Worker('normalize_turns', async (job) => {
      calls[job.name] = (calls[job.name] ?? 0) + 1;
      (timestamps[job.name] ??= []).push(Date.now());
      if (job.data.scenario === 'run-id') return 'completed';
      if (job.name !== 'transient' || calls[job.name] < 3) throw new Error('injected provider failure');
      return 'recovered';
    }, { connection, prefix, concurrency: 2 }));
    workers.push(new Worker('analyze', async (job) => {
      calls[job.name] = (calls[job.name] ?? 0) + 1;
      if (job.data.scenario === 'run-id') return 'completed';
      throw new Error('injected non-idempotent failure');
    }, { connection, prefix }));

    const transient = await normalize.add('transient', {});
    const permanent = await normalize.add('permanent', {});
    const unsafe = await analyze.add('unsafe', {});
    const results = await Promise.allSettled([
      transient.waitUntilFinished(normalizeEvents, 15_000),
      permanent.waitUntilFinished(normalizeEvents, 15_000),
      unsafe.waitUntilFinished(analyzeEvents, 15_000),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    expect(calls).toMatchObject({ transient: 3, permanent: 3, unsafe: 1 });
    expect(timestamps.transient[1] - timestamps.transient[0]).toBeGreaterThanOrEqual(900);
    expect(timestamps.transient[2] - timestamps.transient[1]).toBeGreaterThanOrEqual(1900);
    expect(await permanent.getState()).toBe('failed');
    expect(await unsafe.getState()).toBe('failed');

    producer = new FlowProducer({ connection, prefix });
    const flow = await producer.add({
      name: 'parent', queueName: 'analyze', data: {}, opts: queueJobOptions('analyze'),
      children: [{ name: 'flow-permanent', queueName: 'normalize_turns', data: {},
        opts: { ...queueJobOptions('normalize_turns'), failParentOnFailure: true } }],
    });
    await expect(flow.job.waitUntilFinished(analyzeEvents, 15_000)).rejects.toThrow();
    expect(await flow.job.getState()).toBe('failed');
    expect(calls['flow-permanent']).toBe(3);
    expect(calls.parent).toBeUndefined();

    const addRun = (run: string) => producer!.add({
      name: `run-parent-${run}`, queueName: 'analyze', data: { scenario: 'run-id' },
      opts: { ...queueJobOptions('analyze'), jobId: processingJobId('same-source', 'extract', run) },
      children: [{
        name: `run-child-${run}`, queueName: 'normalize_turns', data: { scenario: 'run-id' },
        opts: { ...queueJobOptions('normalize_turns'), jobId: processingJobId('same-source', 'normalize', run), failParentOnFailure: true },
      }],
    });
    const first = await addRun('first');
    await first.job.waitUntilFinished(analyzeEvents, 15_000);
    const second = await addRun('second');
    await second.job.waitUntilFinished(analyzeEvents, 15_000);
    const duplicate = await addRun('first');
    await duplicate.job.waitUntilFinished(analyzeEvents, 15_000);
    expect(first.job.id).not.toBe(second.job.id);
    expect(duplicate.job.id).toBe(first.job.id);
    expect(calls).toMatchObject({ 'run-parent-first': 1, 'run-parent-second': 1, 'run-child-first': 1, 'run-child-second': 1 });
  }, 40_000);
});
