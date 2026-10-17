/** @vitest-environment node */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { TranscribeJobData } from '@/lib/queue/jobs/transcribe';

const dependencies = vi.hoisted(() => ({
  prisma: null as PrismaClient | null,
  asr: vi.fn(),
  analyze: vi.fn(),
}));

// Substitute only the connection: every Prisma operation uses the real database.
vi.mock('@/lib/prisma', () => ({ prisma: dependencies.prisma }));
vi.mock('@/lib/queue/config', () => ({ addAnalyzeJob: dependencies.analyze }));
vi.mock('@/lib/transcription/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/transcription/factory')>();
  return { ...actual, createTranscriptionProvider: () => ({ transcribe: dependencies.asr }) };
});

const databaseUrl = process.env.NSP_TEST_POSTGRES_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['127.0.0.1', 'localhost'].includes(target.hostname)
    || !['/nanosparks_fresh', '/nanosparks_qa'].includes(target.pathname)
    || target.search || target.hash) {
    throw new Error('NSP_TEST_POSTGRES_URL must select a loopback nanosparks_fresh or nanosparks_qa database without URL options');
  }
}

describe.skipIf(!databaseUrl)('transcription persistence against isolated PostgreSQL', () => {
  const workspaceId = `transcribe-pg-${randomUUID()}`;
  let pool: Pool;
  let prisma: PrismaClient;
  let corpusId: string;
  let directory: string;
  let audioPath: string;
  let processTranscribeJob: (data: TranscribeJobData) => Promise<void>;
  const insertBatches: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    const identity = await pool.query<{ name: string }>('SELECT current_database() AS name');
    expect(['nanosparks_fresh', 'nanosparks_qa']).toContain(identity.rows[0].name);
    const client = new PrismaClient({
      adapter: new PrismaPg(pool),
      log: [{ emit: 'event', level: 'query' }],
    });
    client.$on('query', (event) => {
      if (/INSERT INTO (?:"public"\.)?"Turn"/.test(event.query)) insertBatches.push(event.duration);
    });
    prisma = client;
    dependencies.prisma = prisma;
    ({ processTranscribeJob } = await import('@/lib/queue/jobs/transcribe'));
    await prisma.workspace.create({ data: { id: workspaceId, name: workspaceId } });
    const corpus = await prisma.corpus.create({ data: { workspaceId, name: workspaceId } });
    corpusId = corpus.id;
    directory = await mkdtemp(join(tmpdir(), 'nanosparks-transcribe-pg-'));
    audioPath = join(directory, 'fixture.mp3');
    await writeFile(audioPath, 'External ASR is stubbed; the persistence path reads this fixture only.');
  }, 30_000);

  beforeEach(() => {
    dependencies.asr.mockReset();
    dependencies.analyze.mockReset();
    insertBatches.length = 0;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
        expect(await prisma.workspace.count({ where: { id: workspaceId } })).toBe(0);
      }
    } finally {
      await prisma?.$disconnect();
      await pool?.end();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  async function fixture() {
    const source = await prisma.source.create({ data: { corpusId, kind: 'media_upload', status: 'completed' } });
    const conversation = await prisma.conversation.create({
      data: { id: randomUUID(), corpusId, sourceId: source.id, title: 'English PostgreSQL fixture', status: 'completed', language: 'en' },
    });
    const participant = await prisma.participant.create({ data: { conversationId: conversation.id, name: 'Original speaker' } });
    const turn = await prisma.turn.create({
      data: { conversationId: conversation.id, participantId: participant.id, text: 'Original transcript', cleanText: 'Original transcript', startMs: 0, endMs: 1000, turnIndex: 0 },
    });
    const thoughtUnit = await prisma.thoughtUnit.create({
      data: { conversationId: conversation.id, participantId: participant.id, type: 'claim', text: 'Original claim' },
    });
    const evidence = await prisma.evidenceSpan.create({
      data: { thoughtUnitId: thoughtUnit.id, turnId: turn.id, quote: turn.text, startMs: 0, endMs: 1000 },
    });
    return { source, conversation, participant, turn, thoughtUnit, evidence };
  }

  function transcript(length: number) {
    return {
      language: 'en', provider: 'postgres-fixture',
      segments: Array.from({ length }, (_, index) => ({
        startMs: index * 200, endMs: (index + 1) * 200,
        text: `English transcript word ${index}`, speakerLabel: `speaker-${index % 2}`, confidence: 0.9,
      })),
    };
  }

  it('commits all 19,818 turns, participant links and final statuses', async () => {
    const existing = await fixture();
    const result = transcript(19_818);
    dependencies.asr.mockResolvedValueOnce(result);
    insertBatches.length = 0;
    const started = Date.now();
    await processTranscribeJob({ conversationId: existing.conversation.id, audioPath, step: 'transcribe' });
    const elapsedMs = Date.now() - started;

    const turns = await prisma.turn.findMany({ where: { conversationId: existing.conversation.id }, orderBy: { turnIndex: 'asc' } });
    expect(turns).toHaveLength(19_818);
    expect(turns.map((turn) => turn.turnIndex)).toEqual(result.segments.map((_, index) => index));
    expect(turns.map((turn) => ({ text: turn.text, startMs: turn.startMs, endMs: turn.endMs })))
      .toEqual(result.segments.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })));
    expect(new Set(turns.map((turn) => turn.participantId)).size).toBe(2);
    expect(turns.every((turn) => turn.participantId && turn.cleanText === turn.text)).toBe(true);
    expect(await prisma.participant.count({ where: { conversationId: existing.conversation.id } })).toBe(2);
    expect(await prisma.conversation.findUnique({ where: { id: existing.conversation.id } })).toMatchObject({ status: 'transcribed', language: 'en' });
    expect(await prisma.source.findUnique({ where: { id: existing.source.id } })).toMatchObject({ status: 'transcribed' });
    expect(await prisma.turn.findUnique({ where: { id: existing.turn.id } })).toBeNull();
    expect(insertBatches).toHaveLength(20);
    expect(dependencies.analyze).not.toHaveBeenCalled();
    process.stdout.write(`${JSON.stringify({ event: 'transcribe_postgres_19818_committed', elapsedMs, turns: turns.length, batches: insertBatches.length })}\n`);
  }, 90_000);

  it('rolls back the first batch and preserves old evidence when the second batch exceeds the database integer range', async () => {
    const existing = await fixture();
    const result = transcript(2500);
    // Int4 overflow fails batch 2 after batch 1 was written in the real transaction.
    result.segments[1000].endMs = 2_147_483_648;
    dependencies.asr.mockResolvedValueOnce(result);
    insertBatches.length = 0;
    await expect(processTranscribeJob({ conversationId: existing.conversation.id, audioPath }))
      .rejects.toThrow(/integer|out of range|INT4|fit/i);

    expect(insertBatches.length).toBeGreaterThanOrEqual(1);
    expect(insertBatches.length).toBeLessThanOrEqual(2);
    expect(await prisma.turn.findMany({ where: { conversationId: existing.conversation.id } })).toEqual([existing.turn]);
    expect(await prisma.participant.findMany({ where: { conversationId: existing.conversation.id } })).toEqual([existing.participant]);
    expect(await prisma.evidenceSpan.findUnique({ where: { id: existing.evidence.id } })).toEqual(existing.evidence);
    expect(await prisma.thoughtUnit.findUnique({ where: { id: existing.thoughtUnit.id } })).toEqual(existing.thoughtUnit);
    expect(await prisma.conversation.findUnique({ where: { id: existing.conversation.id } })).toMatchObject({ status: 'failed' });
    expect(await prisma.source.findUnique({ where: { id: existing.source.id } })).toMatchObject({ status: 'failed' });
    expect(dependencies.analyze).not.toHaveBeenCalled();
    process.stdout.write(`${JSON.stringify({ event: 'transcribe_postgres_second_batch_rolled_back', observedInsertQueries: insertBatches.length, preservedTurnId: existing.turn.id })}\n`);
  }, 90_000);
});
