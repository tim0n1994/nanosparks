import { beforeEach, describe, expect, it, vi } from 'vitest';

// NSP_RELIABLE_EXTRACTION gate (CTO ruling 2026-10-21): the iter3 fast-tier
// reliability layer ships on main DEFAULT OFF. The gate lives only in the
// analyze.ts wiring of the window-extraction step: with the switch off, every
// window goes through the plain extractFromWindow — no four-way validation,
// no same-model retry, no auto fallback, and no fallback events. Only the
// exact value 'on' routes fast-tier windows through extractFromWindowReliable.

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
    extract: vi.fn(), reliable: vi.fn(), windows: vi.fn(), complete: vi.fn(), correction: vi.fn(),
    mergeGraph: vi.fn().mockResolvedValue(undefined), appendEvent: vi.fn(), routed: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/llm/client', () => ({
  OpenAIClient: class { completeWithRetry = mocks.complete; },
  ClaudeClient: class { completeWithRetry = mocks.complete; },
  attachSecondaryFromSettings: vi.fn(),
  validateJsonResponse: (content: string, schema: { parse: (value: unknown) => unknown }) => schema.parse(JSON.parse(content)),
  parseLenientJson: (content: string) => JSON.parse(content),
  salvageTruncatedJson: () => null,
  resolveLlmTimeoutMs: () => 240_000,
}));
vi.mock('@/lib/settings', () => ({ getLlmSettings: vi.fn() }));
vi.mock('@/lib/extraction/model-router', () => ({
  getConsentStatusForConversation: vi.fn().mockResolvedValue('public'),
  getRoutedLlmSettings: mocks.routed,
}));
vi.mock('@/lib/extraction/windowed-extraction', () => ({
  createWindows: mocks.windows,
  extractFromWindow: mocks.extract,
  windowMinCoverage: () => 0.9,
  mergeExtractions: (results: Array<{ thoughtUnits: unknown[] }>) => ({ thoughtUnits: results.flatMap((r) => r.thoughtUnits), relations: [] }),
}));
// The reliable layer is mocked at its entry point so these tests can count
// which path analyze.ts actually wired in. isFastTierModel mirrors the real
// implementation's regex because the gate preserves the iter3 layer's
// fast-tier scope (the 'auto' control arm never gets the wrapper).
vi.mock('@/lib/extraction/reliable-window', () => ({
  extractFromWindowReliable: mocks.reliable,
  isFastTierModel: (model: unknown) => typeof model === 'string' && /fast/i.test(model),
}));
// Fallback events are written via fs.appendFileSync inside reliable-window
// (mocked above). Spying here also makes the "no events" assertion fail if a
// future change wires event logging directly into analyze.
vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:fs')>()), appendFileSync: mocks.appendEvent }));
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
import type { TranscriptWindow } from '@/lib/extraction/windowed-extraction';

const FAST_MODEL = 'deepseek-v4.1-flash-fast';
const result = (index: number, text = 'An evidence-backed insight') => ({
  windowIndex: index,
  thoughtUnits: [{ type: 'insight', text, confidence: 0.8, evidenceSpans: [] }], entities: [],
});
const job = { conversationId: 'conversation', sourceId: 'source' };

describe('NSP_RELIABLE_EXTRACTION gate (default off)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NSP_RELIABLE_EXTRACTION;
    mocks.db.turn.findMany.mockResolvedValue([{ id: 'turn', turnIndex: 0, startMs: 0, endMs: 1000, text: 'Real transcript', participant: null }]);
    mocks.db.conversation.findUnique.mockResolvedValue({ id: 'conversation', corpusId: 'corpus', language: 'zh' });
    mocks.db.extractionRun.create.mockResolvedValue({ id: 'new-run', params: { tier: 'cloud' } });
    mocks.db.extractionRun.findUnique.mockResolvedValue({ id: 'new-run', conversationId: 'conversation', isActive: false, params: { tier: 'cloud' } });
    mocks.windows.mockReturnValue([{ index: 0 }, { index: 1 }]);
    mocks.extract.mockImplementation(async (_client, window) => result(window.index));
    mocks.reliable.mockImplementation(async (_client, window: TranscriptWindow) => result(window.index));
    mocks.routed.mockResolvedValue({ model: 'mock', tier: 'cloud' });
    mocks.complete.mockResolvedValue({ content: '[]' });
    mocks.db.thoughtUnit.create.mockResolvedValue({ id: 'new-tu' });
    mocks.db.thoughtUnit.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.thoughtUnit.findMany.mockResolvedValue([]);
    mocks.db.conversation.update.mockResolvedValue({});
    mocks.db.participant.findMany.mockResolvedValue([]);
    mocks.db.turn.update.mockResolvedValue({});
    mocks.correction.mockResolvedValue({ outputs: [], costUsd: 0 });
  });

  it('default (env unset) keeps even fast-tier windows on the plain path with no events', async () => {
    mocks.routed.mockResolvedValue({ model: FAST_MODEL, tier: 'cloud' });
    await processAnalyzeJob(job);
    expect(mocks.extract).toHaveBeenCalledTimes(2);
    expect(mocks.reliable).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it("treats non-'on' values ('true') as off even for a fast-tier model", async () => {
    process.env.NSP_RELIABLE_EXTRACTION = 'true';
    mocks.routed.mockResolvedValue({ model: FAST_MODEL, tier: 'cloud' });
    await processAnalyzeJob(job);
    expect(mocks.extract).toHaveBeenCalledTimes(2);
    expect(mocks.reliable).not.toHaveBeenCalled();
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it("NSP_RELIABLE_EXTRACTION='on' routes fast-tier windows through the reliable entry", async () => {
    process.env.NSP_RELIABLE_EXTRACTION = 'on';
    mocks.routed.mockResolvedValue({ model: FAST_MODEL, tier: 'cloud' });
    await processAnalyzeJob(job);
    expect(mocks.reliable).toHaveBeenCalledTimes(2);
    expect(mocks.reliable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ index: 0 }),
      expect.objectContaining({ model: FAST_MODEL, conversationId: 'conversation' }),
    );
    expect(mocks.extract).not.toHaveBeenCalled();
  });

  it("NSP_RELIABLE_EXTRACTION='on' keeps non-fast models on the plain path (A/B control arm)", async () => {
    process.env.NSP_RELIABLE_EXTRACTION = 'on';
    mocks.routed.mockResolvedValue({ model: 'auto', tier: 'cloud' });
    await processAnalyzeJob(job);
    expect(mocks.extract).toHaveBeenCalledTimes(2);
    expect(mocks.reliable).not.toHaveBeenCalled();
  });
});
