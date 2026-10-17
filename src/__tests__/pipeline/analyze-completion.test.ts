import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'new-tu' }), update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({ id: 'analysis' }), createMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  const db = {
    conversation: model(), source: model(), turn: model(), extractionRun: model(),
    thoughtUnit: model(), participant: model(), evidenceSpan: model(), corpus: model(),
    entityMention: model(), episode: model(), analysis: model(), referenceLink: model(),
  };
  return {
    db: { ...db, $transaction: vi.fn(async (fn: (tx: typeof db) => unknown) => fn(db)) },
    extract: vi.fn(), windows: vi.fn(), complete: vi.fn(), correction: vi.fn(), mergeGraph: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/llm/client', () => ({
  OpenAIClient: class { completeWithRetry = mocks.complete; },
  ClaudeClient: class { completeWithRetry = mocks.complete; },
  attachSecondaryFromSettings: vi.fn(),
  validateJsonResponse: (content: string, schema: { parse: (value: unknown) => unknown }) => schema.parse(JSON.parse(content)),
}));
vi.mock('@/lib/settings', () => ({ getLlmSettings: vi.fn() }));
vi.mock('@/lib/extraction/model-router', () => ({
  getConsentStatusForConversation: vi.fn().mockResolvedValue('public'),
  getRoutedLlmSettings: vi.fn().mockResolvedValue({ model: 'mock', tier: 'cloud' }),
}));
vi.mock('@/lib/extraction/windowed-extraction', () => ({
  createWindows: mocks.windows,
  extractFromWindow: mocks.extract,
  mergeExtractions: (results: Array<{ thoughtUnits: unknown[] }>) => ({ thoughtUnits: results.flatMap((r) => r.thoughtUnits), relations: [] }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/adapters/episode-to-conversation', () => ({ updateConversationStatus: vi.fn() }));
vi.mock('@/lib/graph/builder', () => ({ rebuildCorpusGraph: vi.fn() }));
vi.mock('@/lib/person/distillation-pipeline', () => ({ runDistillationForConversation: vi.fn() }));
vi.mock('@/lib/graph/incremental', () => ({ mergeConversationIntoGraph: mocks.mergeGraph }));
vi.mock('@/lib/graph/canonical-claim', () => ({ buildCanonicalClaims: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/embeddings/projection', () => ({ projectCorpus: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/person/profile-builder', () => ({ buildPersonProfile: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({ generateEmbeddings: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/embeddings/search', () => ({ storeEmbeddings: vi.fn() }));
vi.mock('@/lib/transcription/speaker-mapper', () => ({ mapSpeakerNames: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/transcription/correction-pass', () => ({ runCorrectionPass: mocks.correction }));
vi.mock('@/lib/transcription/hotwords', () => ({
  growShowGlossary: vi.fn().mockResolvedValue(undefined), extractGlossaryCandidates: vi.fn().mockReturnValue([]), loadShowGlossary: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/guardrails', () => ({ costBreakerTripped: vi.fn().mockReturnValue(false) }));
vi.mock('@/lib/public-slug', () => ({ ensurePublicSlug: vi.fn() }));
vi.mock('@/lib/entity/resolver', () => ({ persistConversationEntities: vi.fn() }));
vi.mock('@/lib/queue/config', () => ({ projectQueue: { add: vi.fn() }, personProfileQueue: { add: vi.fn() } }));
vi.mock('@/lib/auth/conversation-access', () => ({ requireConversationAccess: vi.fn().mockResolvedValue({ userId: 'owner' }) }));
vi.mock('@/lib/quota', () => ({ getMonthlyQuotaStatus: vi.fn() }));
vi.mock('@/lib/billing/tier', () => ({ getUserTier: vi.fn(), monthlyQuotaFor: vi.fn() }));

import { processAnalyzeJob } from '@/lib/queue/jobs/analyze';
import { runDistillationForConversation } from '@/lib/person/distillation-pipeline';
import { POST as reextract } from '@/app/api/conversations/[id]/reextract/route';
import type { NextRequest } from 'next/server';
import type { OpenAIClient } from '@/lib/llm/client';
import type { TranscriptWindow } from '@/lib/extraction/windowed-extraction';

const result = (index: number, text = 'An evidence-backed insight') => ({
  windowIndex: index,
  thoughtUnits: [{ type: 'insight', text, confidence: 0.8, evidenceSpans: [] }], entities: [],
});
const job = { conversationId: 'conversation', sourceId: 'source' };

function expectNotCompleted() {
  expect(mocks.db.conversation.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }));
  expect(mocks.db.extractionRun.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  expect(mocks.db.extractionRun.updateMany).not.toHaveBeenCalled();
}

describe('analysis completion integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.turn.findMany.mockResolvedValue([{ id: 'turn', turnIndex: 0, startMs: 0, endMs: 1000, text: 'Real transcript', participant: null }]);
    mocks.db.conversation.findUnique.mockResolvedValue({ id: 'conversation', corpusId: 'corpus', language: 'zh' });
    mocks.db.extractionRun.create.mockResolvedValue({ id: 'new-run', params: { tier: 'cloud' } });
    mocks.db.extractionRun.findUnique.mockResolvedValue({ id: 'new-run', conversationId: 'conversation', isActive: false, params: { tier: 'cloud' } });
    mocks.windows.mockReturnValue([{ index: 0 }, { index: 1 }]);
    mocks.extract.mockImplementation(async (_client, window) => result(window.index));
    mocks.complete.mockResolvedValue({ content: '[]' });
    mocks.db.thoughtUnit.create.mockResolvedValue({ id: 'new-tu' });
    mocks.db.thoughtUnit.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.thoughtUnit.findMany.mockResolvedValue([]);
    mocks.db.conversation.update.mockResolvedValue({});
    mocks.db.participant.findMany.mockResolvedValue([]);
    mocks.db.turn.update.mockResolvedValue({});
    mocks.correction.mockResolvedValue({ outputs: [], costUsd: 0 });
  });

  it('persists corrections by global turn index with gaps and skips unknown indices', async () => {
    mocks.db.turn.findMany.mockResolvedValue([
      { id: 'turn-2', turnIndex: 2, startMs: 0, endMs: 1000, text: 'First original', rawText: null, participant: null },
      { id: 'turn-70', turnIndex: 70, startMs: 1000, endMs: 2000, text: 'Second original', rawText: null, participant: null },
    ]);
    mocks.correction.mockResolvedValue({ outputs: [{ turnIndex: 70, text: 'Second corrected', corrections: 1 }, { turnIndex: 999, text: 'Foreign correction', corrections: 1 }], costUsd: 0 });
    await processAnalyzeJob(job);
    expect(mocks.db.turn.update).toHaveBeenCalledTimes(1);
    expect(mocks.db.turn.update).toHaveBeenCalledWith({ where: { id: 'turn-70' }, data: { text: 'Second corrected', rawText: 'Second original', cleanText: 'Second corrected' } });
  });

  it('keeps the first ASR text when a corrected turn is corrected again', async () => {
    mocks.db.turn.findMany.mockResolvedValue([{ id: 'turn', turnIndex: 0, startMs: 0, endMs: 1000, text: 'First correction', rawText: 'Initial ASR', participant: null }]);
    mocks.correction.mockResolvedValue({ outputs: [{ turnIndex: 0, text: 'Second correction', corrections: 1 }], costUsd: 0 });
    await processAnalyzeJob(job);
    expect(mocks.db.turn.update).toHaveBeenCalledWith({ where: { id: 'turn' }, data: { text: 'Second correction', cleanText: 'Second correction' } });
  });

  it('uses successfully persisted correction text downstream and redacts the reader overlay', async () => {
    const corrected = 'Email marc@example.com about the corrected topic.';
    mocks.db.turn.findMany.mockResolvedValue([{ id: 'turn-70', turnIndex: 70, startMs: 1000, endMs: 2000, text: 'Original topic', rawText: null, cleanText: 'Original topic', participant: null }]);
    mocks.correction.mockResolvedValue({ outputs: [{ turnIndex: 70, text: corrected, corrections: 1 }], costUsd: 0 });
    await processAnalyzeJob(job);
    expect(mocks.db.turn.update).toHaveBeenCalledWith({ where: { id: 'turn-70' }, data: { text: corrected, rawText: 'Original topic', cleanText: 'Email [REDACTED_EMAIL] about the corrected topic.' } });
    expect(mocks.windows).toHaveBeenCalledWith([expect.objectContaining({ turnIndex: 70, text: corrected })]);
    const discoveryPrompt = mocks.complete.mock.calls[0][0][0].content;
    expect(discoveryPrompt).toContain(corrected);
    expect(discoveryPrompt).not.toContain('Original topic');
  });

  it('does not forward a correction whose database write failed', async () => {
    mocks.db.turn.findMany.mockResolvedValue([{ id: 'turn-70', turnIndex: 70, startMs: 1000, endMs: 2000, text: 'Original topic', rawText: null, cleanText: 'Original topic', participant: null }]);
    mocks.correction.mockResolvedValue({ outputs: [{ turnIndex: 70, text: 'Unpersisted correction', corrections: 1 }], costUsd: 0 });
    mocks.db.turn.update.mockRejectedValueOnce(new Error('write failed'));
    await processAnalyzeJob(job);
    expect(mocks.windows).toHaveBeenCalledWith([expect.objectContaining({ turnIndex: 70, text: 'Original topic' })]);
    expect(mocks.complete.mock.calls[0][0][0].content).not.toContain('Unpersisted correction');
  });

  it('rejects all-window failure, records coverage, and preserves previous products', async () => {
    mocks.extract.mockRejectedValue(new Error('provider unavailable'));
    await expect(processAnalyzeJob(job)).rejects.toThrow(/window/i);
    expectNotCompleted();
    expect(mocks.db.thoughtUnit.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.thoughtUnit.create).not.toHaveBeenCalled();
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'new-run' }, data: expect.objectContaining({ status: 'failed' }),
    }));
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ params: expect.objectContaining({ coverage: expect.objectContaining({ totalWindows: 2, successfulWindows: 0, status: 'failed' }) }) }),
    }));
  });

  it('conversation enrichment requests only speakers and preserves participant ids and existing TU links', async () => {
    mocks.db.turn.findMany.mockResolvedValue([{ id: 'turn', turnIndex: 70, startMs: 0, endMs: 1000, text: 'Marc speaks here.', participantId: 'existing', participant: { name: 'Marc Andreessen' } }]);
    mocks.db.participant.findMany.mockResolvedValue([{ id: 'existing', name: 'Marc Andreessen', speakerLabel: 'SPEAKER_00' }]);
    mocks.complete.mockImplementation(async (messages: Array<{ content: string }>) => ({
      content: JSON.stringify(messages[0].content.startsWith('ASSIGN') ? [{ turnIndex: 70, speakerId: 's1' }] : [{ id: 's1', name: 'Marc Andreessen', role: 'guest' }]),
    }));
    await processAnalyzeJob(job);
    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.db.participant.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.participant.create).not.toHaveBeenCalled();
    expect(mocks.db.turn.update).toHaveBeenCalledWith({ where: { id: 'turn' }, data: { participantId: 'existing', attributionMethod: 'llm', attributionConfidence: null } });
    expect(runDistillationForConversation).toHaveBeenCalledWith('conversation', expect.objectContaining({ speakerAssignmentsComplete: true }));
  });

  it('preserves existing attribution when speaker assignment is unknown or ambiguous', async () => {
    mocks.db.participant.findMany.mockResolvedValue([{ id: 'existing', name: 'Marc Andreessen', speakerLabel: 'SPEAKER_00' }]);
    mocks.complete.mockImplementation(async (messages: Array<{ content: string }>) => ({ content: JSON.stringify(messages[0].content.startsWith('ASSIGN') ? [{ turnIndex: 0, speakerId: null }] : [{ name: 'Marc Andreessen' }]) }));
    await processAnalyzeJob(job);
    expect(mocks.db.participant.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.participant.create).not.toHaveBeenCalled();
    expect(mocks.db.turn.update).not.toHaveBeenCalled();
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ params: expect.objectContaining({ speakerEnrichment: expect.objectContaining({ unknownTurns: 1 }) }) }) }));
  });

  it('adds a supported named participant without overwriting old participants when discovery is new', async () => {
    mocks.db.participant.findMany.mockResolvedValue([{ id: 'unresolved', name: 'Speaker 1', speakerLabel: 'SPEAKER_00' }]);
    mocks.db.participant.create.mockResolvedValue({ id: 'named' });
    mocks.complete.mockImplementation(async (messages: Array<{ content: string }>) => ({ content: JSON.stringify(messages[0].content.startsWith('ASSIGN') ? [{ turnIndex: 0, speakerId: 's1' }] : [{ name: 'Marc Andreessen' }]) }));
    await processAnalyzeJob(job);
    expect(mocks.db.participant.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.participant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Marc Andreessen', isResolved: false, confidence: 0.7 }) });
    expect(mocks.db.turn.update).toHaveBeenCalledWith({ where: { id: 'turn' }, data: { participantId: 'named', attributionMethod: 'llm', attributionConfidence: null } });
  });

  it('revalidates global source coordinates before persisting evidence', async () => {
    const quote = 'US K-12 schools are a literal government monopoly.';
    mocks.db.turn.findMany.mockResolvedValue([
      { id: 'intro', turnIndex: 2, startMs: 53965, endMs: 79835, text: 'Welcome to the introduction.', participant: null },
      { id: 'late', turnIndex: 400, startMs: 4500250, endMs: 4520000, text: quote, participant: null },
    ]);
    mocks.windows.mockReturnValue([{ index: 0 }]);
    mocks.extract.mockResolvedValue({ windowIndex: 0, entities: [], thoughtUnits: [{ type: 'claim', text: 'Claim', confidence: 0.9, evidenceSpans: [{ quote, turnIndex: 2, startMs: 78000, endMs: 79000 }] }] });
    await processAnalyzeJob(job);
    expect(mocks.db.evidenceSpan.create).toHaveBeenCalledWith({ data: expect.objectContaining({ turnId: 'late', startMs: 4500250, endMs: 4520000, quote }) });
    expect(mocks.db.evidenceSpan.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ turnId: 'intro' }) });
  });

  it('rejects partial coverage without replacing old data or activating the partial run', async () => {
    mocks.extract.mockResolvedValueOnce(result(0)).mockRejectedValueOnce(new Error('rate limited'));
    await expect(processAnalyzeJob(job)).rejects.toThrow(/window/i);
    expectNotCompleted();
    expect(mocks.db.thoughtUnit.create).not.toHaveBeenCalled();
    expect(mocks.db.thoughtUnit.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ params: expect.objectContaining({ coverage: expect.objectContaining({ totalWindows: 2, successfulWindows: 1, status: 'partial', failedWindows: [{ index: 1, error: 'Error: rate limited' }] }) }) }),
    }));
  });

  it.each([{ turns: [] }, { turns: [{ id: 'blank', turnIndex: 0, startMs: 0, endMs: 1, text: ' \n ', participant: null }] }])('rejects missing or blank transcript before model extraction: %j', async ({ turns }) => {
    mocks.db.turn.findMany.mockResolvedValue(turns);
    await expect(processAnalyzeJob(job)).rejects.toThrow(/turn|transcript/i);
    expectNotCompleted();
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it.each([{ thoughtUnits: [] }, { thoughtUnits: [result(0, '   ').thoughtUnits[0]] }])('rejects empty effective extraction: %j', async ({ thoughtUnits }) => {
    mocks.extract.mockResolvedValue({ windowIndex: 0, thoughtUnits, entities: [] });
    await expect(processAnalyzeJob(job)).rejects.toThrow(/empty|thought/i);
    expectNotCompleted();
    expect(mocks.db.thoughtUnit.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects zero windows rather than treating zero successes as complete coverage', async () => {
    mocks.windows.mockReturnValue([]);
    await expect(processAnalyzeJob(job)).rejects.toThrow(/window/i);
    expectNotCompleted();
  });

  it('completes a full nonempty extraction and activates its run', async () => {
    await processAnalyzeJob(job);
    expect(mocks.db.thoughtUnit.create).toHaveBeenCalledTimes(2);
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'new-run' }, data: expect.objectContaining({ status: 'completed', isActive: true }) }));
    expect(mocks.db.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'completed' } }));
    expect(mocks.db.$transaction).toHaveBeenCalled();
    const deletion = mocks.db.thoughtUnit.deleteMany.mock.calls.find(([args]) => args.where.OR);
    expect(deletion?.[0].where).toEqual({ conversationId: 'conversation', OR: [{ runId: { not: 'new-run' } }, { runId: null }] });
  });

  it('allows a valid empty window when another window supplies effective thought units', async () => {
    mocks.extract.mockResolvedValueOnce({ windowIndex: 0, thoughtUnits: [], entities: [] }).mockResolvedValueOnce(result(1));
    await processAnalyzeJob(job);
    expect(mocks.db.thoughtUnit.create).toHaveBeenCalledTimes(1);
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed', isActive: true }) }));
  });

  it('fails a timed-out window without activating a late result', async () => {
    vi.useFakeTimers();
    try {
      let resolveWindow!: (value: ReturnType<typeof result>) => void;
      mocks.extract.mockImplementationOnce(() => new Promise((resolve) => { resolveWindow = resolve; }));
      const outcome = expect(processAnalyzeJob(job)).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(300_001);
      await outcome;
      resolveWindow(result(0));
      await vi.advanceTimersByTimeAsync(1);
      expectNotCompleted();
      expect(mocks.db.thoughtUnit.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-use an active run and erase its products', async () => {
    mocks.db.extractionRun.findUnique.mockResolvedValue({ id: 'old-run', conversationId: 'conversation', isActive: true });
    await expect(processAnalyzeJob({ ...job, extractionRunId: 'old-run' })).rejects.toThrow(/active extraction run/);
    expectNotCompleted();
    expect(mocks.db.thoughtUnit.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.extractionRun.update).not.toHaveBeenCalled();
  });

  it('marks a newly created legacy run failed when all model output is empty', async () => {
    mocks.db.episode.findUnique.mockResolvedValue({ transcript: [{ text: 'Real transcript' }] });
    await expect(processAnalyzeJob({ episodeId: 'episode', conversationId: 'conversation' })).rejects.toThrow(/no effective thought units/);
    expectNotCompleted();
    expect(mocks.db.analysis.upsert).not.toHaveBeenCalled();
    expect(mocks.db.thoughtUnit.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'new-run' }, data: expect.objectContaining({ status: 'failed' }) }));
  });

  it('runs derived graph processing against only the newly promoted products', async () => {
    let products = [{ id: 'old-tu', runId: 'old-run', text: 'Old insight' }];
    mocks.db.thoughtUnit.create.mockImplementation(async ({ data }) => {
      const created = { id: `new-tu-${products.length}`, runId: data.runId, text: data.text };
      products.push(created);
      return created;
    });
    mocks.db.thoughtUnit.deleteMany.mockImplementation(async ({ where }) => {
      products = products.filter((tu) => where.OR ? tu.runId === 'new-run' : tu.runId !== where.runId);
      return { count: 0 };
    });
    const observed: string[][] = [];
    mocks.mergeGraph.mockImplementationOnce(async () => { observed.push(products.map((tu) => tu.runId)); });
    await processAnalyzeJob(job);
    expect(observed).toEqual([['new-run', 'new-run']]);
  });

  it('keeps committed extraction complete if a later derived-stage lookup fails', async () => {
    mocks.db.conversation.findUnique.mockImplementation(async ({ select }) => {
      if (select.language) throw new Error('derived-stage database lookup failed');
      return { id: 'conversation', corpusId: 'corpus' };
    });
    await expect(processAnalyzeJob(job)).resolves.toBeUndefined();
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true, status: 'completed' }) }));
    expect(mocks.db.extractionRun.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
    expect(mocks.db.conversation.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
    expect(mocks.db.thoughtUnit.deleteMany).toHaveBeenCalledTimes(2);
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ params: expect.objectContaining({ degradation: expect.objectContaining({ error: 'Error: derived-stage database lookup failed' }) }) }),
    }));
  });

  it('keeps analyzing and rejects retry while the writing tail is still running', async () => {
    let status = 'pending';
    mocks.db.conversation.update.mockImplementation(async ({ data }) => { status = data.status; return { status }; });
    mocks.db.conversation.findUnique.mockImplementation(async () => ({ id: 'conversation', corpusId: 'corpus', status, language: 'zh' }));
    let signalStarted!: () => void;
    let finishTail!: (value: { content: string }) => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const tail = new Promise<{ content: string }>((resolve) => { finishTail = resolve; });
    mocks.complete.mockImplementationOnce(() => { signalStarted(); return tail; });
    const running = processAnalyzeJob(job);
    try {
      await started;
      expect(status).toBe('analyzing');
      expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
      const response = await reextract(new Request('http://localhost/api/conversations/conversation/reextract', { method: 'POST', body: '{}' }) as NextRequest, { params: Promise.resolve({ id: 'conversation' }) });
      expect(response.status).toBe(409);
      expect(mocks.db.conversation.updateMany).not.toHaveBeenCalled();
    } finally {
      finishTail({ content: '[]' });
      await running;
    }
    expect(status).toBe('completed');
  });

  it('does not mutate an extraction run belonging to another conversation', async () => {
    mocks.db.extractionRun.findUnique.mockResolvedValue({ id: 'foreign-run', conversationId: 'other-conversation', isActive: false });
    await expect(processAnalyzeJob({ ...job, extractionRunId: 'foreign-run' })).rejects.toThrow(/another conversation/);
    expect(mocks.db.extractionRun.update).not.toHaveBeenCalled();
    expect(mocks.db.thoughtUnit.deleteMany).not.toHaveBeenCalled();
  });

  it('does not delete previous runs when new thought-unit persistence fails', async () => {
    mocks.db.thoughtUnit.create.mockRejectedValueOnce(new Error('database write failed'));
    await expect(processAnalyzeJob(job)).rejects.toThrow('database write failed');
    expectNotCompleted();
    for (const [args] of mocks.db.thoughtUnit.deleteMany.mock.calls) {
      expect(args.where).toMatchObject({ conversationId: 'conversation', runId: 'new-run' });
    }
    expect(mocks.db.extractionRun.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'new-run' }, data: expect.objectContaining({ status: 'failed' }) }));
  });
});

describe('real window fallback distinguishes empty results from errors', () => {
  const window: TranscriptWindow = { index: 0, startMs: 0, endMs: 1000, turnIndices: [0], text: 'Transcript', speakers: [] };

  it.each(['not JSON', '{"thoughtUnits":"bad shape"}'])('propagates malformed fallback response: %s', async (content) => {
    const { extractFromWindow } = await vi.importActual<typeof import('@/lib/extraction/windowed-extraction')>('@/lib/extraction/windowed-extraction');
    const client = {
      completeStructured: vi.fn().mockRejectedValue(new Error('structured request failed')),
      completeWithRetry: vi.fn().mockResolvedValue({ content }),
    };
    await expect(extractFromWindow(client as unknown as OpenAIClient, window)).rejects.toThrow();
  });

  it.each(['[]', '{"thoughtUnits":[]}'])('preserves a valid empty fallback response: %s', async (content) => {
    const { extractFromWindow } = await vi.importActual<typeof import('@/lib/extraction/windowed-extraction')>('@/lib/extraction/windowed-extraction');
    const client = {
      completeStructured: vi.fn().mockRejectedValue(new Error('structured request failed')),
      completeWithRetry: vi.fn().mockResolvedValue({ content }),
    };
    await expect(extractFromWindow(client as unknown as OpenAIClient, window)).resolves.toMatchObject({ thoughtUnits: [] });
  });
});
