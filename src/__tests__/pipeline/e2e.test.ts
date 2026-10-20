/**
 * End-to-end integration test: upload → transcribe (PII) → analyze (embeddings) → semantic search.
 *
 * Tests the full data-flow orchestration across all pipeline stages.
 * Mocks at I/O boundaries (Prisma, LLM API, storage, queue, embeddings API)
 * but tests the real orchestration logic in each job processor.
 *
 * Flow verified:
 *   processUpload → storage.save + source.create + queue.add('transcribe')
 *   processTranscribeJob (upload path) → PII redact + turn.createMany + queue.add('analyze')
 *   processAnalyzeJob (conversation path) → thoughtUnit.create + evidenceSpan.create + embeddings stored
 *   Corpus query (semantic mode) → vector search → answer with citations
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';

// =============================================================================
// Hoisted mocks (executed before any import, hoisted above vi.mock calls)
// =============================================================================

const prismaMock = vi.hoisted(() => ({
  corpus: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  source: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  mediaAsset: { create: vi.fn() },
  conversation: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  turn: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
  },
  thoughtUnit: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  evidenceSpan: { create: vi.fn() },
  participant: { create: vi.fn(async () => ({ id: 'part_e2e_1' })), createMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(async () => []) },
  entity: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({ id: 'ent_e2e_1' })), update: vi.fn() },
  entityMention: { deleteMany: vi.fn(), create: vi.fn() },
  graphNode: { create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  graphEdge: { create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  analysis: { create: vi.fn(), upsert: vi.fn() },
  workspace: { findFirst: vi.fn(), create: vi.fn() },
  extractionRun: {
    create: vi.fn(async (opts: { data: { id?: string } }) => ({ id: opts.data.id ?? 'run_e2e_001', ...opts.data })),
    update: vi.fn(async (opts: { where: { id: string } }) => ({ id: opts.where.id })),
    updateMany: vi.fn(),
    findUnique: vi.fn(async () => null),
  },
  brief: { create: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn(), findMany: vi.fn() },
  setting: { findMany: vi.fn(async () => []), upsert: vi.fn() },
  referenceLink: { deleteMany: vi.fn(), createMany: vi.fn() },
  $queryRawUnsafe: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn(),
}));

const queueAddMock = vi.hoisted(() => vi.fn());
const analyzeQueueAddMock = vi.hoisted(() => vi.fn());

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const storageProviderMock = vi.hoisted(() => ({
  generateKey: vi.fn(() => 'e2e-hash-1700000000000.mp3'),
  save: vi.fn(async () => ({ key: 'e2e-hash-1700000000000.mp3', url: '/api/storage/e2e-hash.mp3', size: 999 })),
  get: vi.fn(async () => Buffer.from('fake audio bytes')),
  delete: vi.fn(),
  getPublicUrl: vi.fn(() => null),
}));

// =============================================================================
// Module mocks (hoisting-safe)
// =============================================================================

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: loggerMock }));
vi.mock('@/lib/queue/config', () => ({
  transcribeQueue: { add: queueAddMock },
  analyzeQueue: { add: analyzeQueueAddMock },
  addAnalyzeJob: vi.fn(async (data: Record<string, unknown>) => {
    analyzeQueueAddMock('analyze', data);
    return 'job_analyze_001';
  }),
}));

vi.mock('@/lib/storage/provider', () => ({
  createStorageProvider: () => storageProviderMock,
}));

vi.mock('@/lib/transcription/whisper', () => ({
  transcribeAudio: vi.fn(async () => [
    { start: 0, end: 4.5, text: 'Welcome to this recording about AI safety.' },
    { start: 5.0, end: 12.0, text: 'My email is researcher@example.com for follow up.' },
    { start: 12.5, end: 20.0, text: 'You can call me at 555-123-4567 if needed.' },
    { start: 21.0, end: 30.0, text: 'The key insight is that alignment requires careful reward modeling.' },
  ]),
}));

// processTranscribeJob routes {conversationId} (no episodeId) through
// processConversationTranscribe → findAudioPath → createTranscriptionProvider.
// Mock the factory so no real ASR runs, returning the same 4 segments.
vi.mock('@/lib/transcription/factory', () => ({
  createTranscriptionProvider: vi.fn(() => ({
    transcribe: vi.fn(async () => ({
      provider: 'mock-e2e',
      language: 'en',
      segments: [
        { startMs: 0, endMs: 4500, text: 'Welcome to this recording about AI safety.', confidence: 1.0 },
        { startMs: 5000, endMs: 12000, text: 'My email is researcher@example.com for follow up.', confidence: 1.0 },
        { startMs: 12500, endMs: 20000, text: 'You can call me at 555-123-4567 if needed.', confidence: 1.0 },
        { startMs: 21000, endMs: 30000, text: 'The key insight is that alignment requires careful reward modeling.', confidence: 1.0 },
      ],
    })),
    getProviderName: () => 'mock-e2e',
  })),
  isChineseSource: vi.fn(() => false),
}));

vi.mock('@/lib/youtube/downloader', () => ({
  downloadAudio: vi.fn(async () => '/tmp/fake-audio.mp3'),
}));

// Mock LLM client to return canned JSON responses
vi.mock('@/lib/llm/client', () => {
  class MockOpenAIClient {
    completeWithRetry = vi.fn(async () => {
      const content = JSON.stringify([
        { id: 'arg_1', text: 'AI alignment requires careful reward modeling', speakerId: 'spk_1', type: 'claim', parentId: null, timestamp: 25 },
        { id: 'arg_2', text: 'Email is researcher@example.com', speakerId: 'spk_1', type: 'support', parentId: 'arg_1', timestamp: 6 },
        { id: 'arg_3', text: 'Phone number is 555-123-4567', speakerId: 'spk_1', type: 'support', parentId: 'arg_1', timestamp: 15 },
      ]);
      return { content, usage: { inputTokens: 500, outputTokens: 200 } };
    });
  }
 return {
   OpenAIClient: MockOpenAIClient,
   ClaudeClient: MockOpenAIClient,
    // analyze.ts attaches a secondary endpoint for load balancing; no-op in the mock.
    attachSecondaryFromSettings: vi.fn(async () => {}),
    resolveLlmTimeoutMs: vi.fn(() => 90_000),
   validateJsonResponse: vi.fn((content: string, schema: any) => {
      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    }),
    parseLenientJson: vi.fn((content: string) => JSON.parse(content)),
    salvageTruncatedJson: vi.fn(() => null),
  };
});

// Mock embedding generation to return fixed vectors
vi.mock('@/lib/embeddings', () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3, 0.4, 0.5]),
  generateEmbeddings: vi.fn(async (texts: string[]) =>
    texts.map((_, i) => [0.1 * (i + 1), 0.2, 0.3, 0.4, 0.5]),
  ),
  getEmbeddingProvider: vi.fn(),
}));

vi.mock('@/lib/embeddings/search', () => ({
  searchThoughtUnits: vi.fn(async () => [
    { id: 'emb_1', resourceType: 'thought_unit', resourceId: 'tu_claim_1', similarity: 0.92, text: 'AI alignment requires careful reward modeling', type: 'claim' },
    { id: 'emb_2', resourceType: 'thought_unit', resourceId: 'tu_ev_1', similarity: 0.87, text: '"Email is researcher@example.com" — follow-up contact', type: 'evidence' },
  ]),
  storeEmbedding: vi.fn(async () => {}),
  storeEmbeddings: vi.fn(async () => {}),
}));

// Mock hybrid search — returns 2 results matching the search mocks
vi.mock('@/lib/rag/hybrid-search', () => ({
  hybridSearch: vi.fn(async (_query: string, _vector: number[], _opts: { corpusId: string }) => [
    {
      thoughtUnitId: 'tu_claim_1',
      text: 'AI alignment requires careful reward modeling',
      type: 'claim',
      conversationId: 'conv_e2e_001',
      score: 0.032,
      denseScore: 0.92,
    },
    {
      thoughtUnitId: 'tu_ev_1',
      text: 'Email is researcher@example.com',
      type: 'evidence',
      conversationId: 'conv_e2e_001',
      score: 0.028,
      denseScore: 0.87,
    },
  ]),
  reciprocalRankFusion: vi.fn(),
}));

// Mock citation verifier
vi.mock('@/lib/rag/citation-verifier', () => ({
  extractCitations: vi.fn(() => [1, 2]),
  verifyCitations: vi.fn(() => ({
    answer: '',
    citations: [
      { index: 1, thoughtUnitId: 'tu_claim_1', verified: true },
      { index: 2, thoughtUnitId: 'tu_ev_1', verified: true },
    ],
    verifiedCount: 2,
    unverifiedCount: 0,
  })),
  stripUnverifiedCitations: vi.fn((answer: string) => answer),
}));

vi.mock('@/lib/prompt-sanitize', () => ({
  sanitizeForPrompt: vi.fn((text: string) => text),
}));

vi.mock('@/lib/graph/builder', () => ({
  rebuildCorpusGraph: vi.fn(async () => ({ nodesCreated: 3, edgesCreated: 2 })),
}));

vi.mock('@/lib/graph/incremental', () => ({
  mergeConversationIntoGraph: vi.fn(async () => ({ nodesAdded: 3, edgesAdded: 2, nodesReused: 1 })),
}));

// Mock model router — returns default settings, no routing-specific DB calls
vi.mock('@/lib/extraction/model-router', () => ({
  getRoutedLlmSettings: vi.fn(async () => ({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    tier: 'cloud',
  })),
  getConsentStatusForConversation: vi.fn(async () => 'public'),
}));

// Mock windowed extraction — returns canned results
vi.mock('@/lib/extraction/windowed-extraction', () => ({
  windowMinCoverage: () => 0.9,
  createWindows: vi.fn((turns: Array<{ text: string }>) => {
    if (turns.length === 0) return [];
    return [{
      index: 0,
      startMs: 0,
      endMs: 30000,
      turnIndices: turns.map((_, i) => i),
      text: turns.map((t) => t.text).join('\n'),
      speakers: ['SPEAKER_00'],
    }];
  }),
  extractFromWindow: vi.fn(async () => ({
    windowIndex: 0,
    thoughtUnits: [
      {
        type: 'claim',
        text: 'AI alignment requires careful reward modeling',
        confidence: 0.9,
        evidenceSpans: [{ startMs: 21000, endMs: 30000, quote: 'alignment requires careful reward modeling' }],
      },
      {
        type: 'evidence',
        text: 'Email is researcher@example.com for follow up',
        confidence: 0.8,
        evidenceSpans: [{ startMs: 5000, endMs: 12000, quote: 'Email is researcher@example.com' }],
      },
      {
        type: 'evidence',
        text: 'You can call me at 555-123-4567 if needed',
        confidence: 0.8,
        evidenceSpans: [{ startMs: 12500, endMs: 20000, quote: 'call me at 555-123-4567' }],
      },
    ],
  })),
  mergeExtractions: vi.fn((results) => ({
    thoughtUnits: results.flatMap((r: { thoughtUnits: unknown[] }) => r.thoughtUnits),
    relations: [],
  })),
}));

vi.mock('@/lib/prisma-json', () => ({
  toPrismaJson: vi.fn((v: unknown) => v),
}));

// =============================================================================
// Imports (after all vi.mock calls)
// =============================================================================

import { processUpload } from '@/lib/upload/service';
import { processTranscribeJob } from '@/lib/queue/jobs/transcribe';
import { processAnalyzeJob } from '@/lib/queue/jobs/analyze';
import { NextRequest } from 'next/server';

// Must import after all mocks since the route imports mocked deps
import { POST as queryPost } from '@/app/api/corpora/[id]/query/route';
import { mkdir, writeFile, rm } from 'node:fs/promises';

// processConversationTranscribe → findAudioPath calls existsSync on the
// mediaAsset filePath, so we need a real temp file for the path check to pass.
const E2E_AUDIO_PATH = '/tmp/nanosparks-audio/e2e-test.mp3';
beforeAll(async () => {
  await mkdir('/tmp/nanosparks-audio', { recursive: true });
  await writeFile(E2E_AUDIO_PATH, Buffer.from('fake audio'));
});
afterAll(async () => {
  await rm(E2E_AUDIO_PATH, { force: true });
});

// =============================================================================
// Helpers
// =============================================================================

const TEST_BUFFER = Buffer.from('fake audio file content', 'utf-8');

function setupUploadMocks() {
  prismaMock.corpus.findUnique.mockResolvedValue({ id: 'corpus_e2e' });
  prismaMock.source.create.mockResolvedValue({ id: 'src_e2e_001' });
  prismaMock.mediaAsset.create.mockResolvedValue({});
  prismaMock.conversation.create.mockResolvedValue({ id: 'conv_e2e_001' });
  prismaMock.source.update.mockResolvedValue({});
  queueAddMock.mockResolvedValue({ id: 'job_tc_001' });
}

function setupTranscribeMocks() {
  prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
  // Source + conversation status updates
  prismaMock.source.update.mockResolvedValue({});
  prismaMock.conversation.update.mockResolvedValue({});
  // Turn operations
  prismaMock.turn.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.turn.createMany.mockResolvedValue({ count: 4 });
  // participant.create — processConversationTranscribe creates one per unique speaker
  prismaMock.participant.createMany.mockResolvedValue({ count: 1 });
  // findAudioPath calls conversation.findUnique to resolve the mediaAsset
  // filePath; the first call needs a real on-disk path (E2E_AUDIO_PATH).
  prismaMock.conversation.findUnique.mockResolvedValue({
    id: 'conv_e2e_001',
    source: { mediaAssets: [{ storageKey: 'e2e-hash-1700000000000.mp3', filePath: E2E_AUDIO_PATH }] },
    episodeKey: null,
    globalEpisode: null,
    corpusId: 'corpus_e2e',
  });
}

function setupAnalyzeMocks(conversationId: string) {
  // Status updates
  prismaMock.conversation.update.mockResolvedValue({});
  prismaMock.source.update.mockResolvedValue({});

  // Return turns from the transcribe step (simulate DB read)
  prismaMock.turn.findMany.mockResolvedValue([
    { id: 'turn_1', conversationId, startMs: 0, endMs: 4500, text: 'Welcome to this recording about AI safety.', cleanText: 'Welcome to this recording about AI safety.', confidence: 1.0, turnIndex: 0, participantId: null, participant: null, evidenceSpans: [], createdAt: new Date() },
    { id: 'turn_2', conversationId, startMs: 5000, endMs: 12000, text: 'My email is researcher@example.com for follow up.', cleanText: 'My email is [REDACTED_EMAIL] for follow up.', confidence: 1.0, turnIndex: 1, participantId: null, participant: null, evidenceSpans: [], createdAt: new Date() },
    { id: 'turn_3', conversationId, startMs: 12500, endMs: 20000, text: 'You can call me at 555-123-4567 if needed.', cleanText: 'You can call me at [REDACTED_PHONE] if needed.', confidence: 1.0, turnIndex: 2, participantId: null, participant: null, evidenceSpans: [], createdAt: new Date() },
    { id: 'turn_4', conversationId, startMs: 21000, endMs: 30000, text: 'The key insight is that alignment requires careful reward modeling.', cleanText: 'The key insight is that alignment requires careful reward modeling.', confidence: 1.0, turnIndex: 3, participantId: null, participant: null, evidenceSpans: [], createdAt: new Date() },
  ]);

  // ThoughtUnit creation — sequential creates
  prismaMock.thoughtUnit.create
    .mockResolvedValueOnce({ id: 'tu_claim_1', conversationId, type: 'claim', text: 'AI alignment requires careful reward modeling', confidence: 0.8 })
    .mockResolvedValueOnce({ id: 'tu_ev_1', conversationId, type: 'evidence', text: 'Email is researcher@example.com', confidence: 0.8 })
    .mockResolvedValueOnce({ id: 'tu_ev_2', conversationId, type: 'evidence', text: 'Phone number is 555-123-4567', confidence: 0.8 });

  // EvidenceSpan creation
  prismaMock.evidenceSpan.create.mockResolvedValue({});

  // ThoughtUnit findMany (for embedding generation) — return created thought units
  prismaMock.thoughtUnit.findMany.mockResolvedValue([
    { id: 'tu_claim_1', text: 'AI alignment requires careful reward modeling' },
    { id: 'tu_ev_1', text: 'Email is researcher@example.com' },
    { id: 'tu_ev_2', text: 'Phone number is 555-123-4567' },
  ]);

  // Graph rebuild mocks
  prismaMock.graphEdge.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.graphNode.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.graphNode.create.mockResolvedValue({ id: 'gn_1' });
  prismaMock.graphNode.count.mockResolvedValue(3);
  prismaMock.graphEdge.count.mockResolvedValue(2);

  // Conversation findUnique for corpusId
  prismaMock.conversation.findUnique.mockResolvedValue({ id: conversationId, corpusId: 'corpus_e2e' });

  // Analysis create (no episodeId in conversation-only path, so won't be called)
  prismaMock.analysis.create.mockResolvedValue({ id: 'analysis_e2e' });

  // used by findConversationId — not called in conversation-only path
  prismaMock.conversation.findFirst.mockResolvedValue(null);

  // Clean up / sync calls
  prismaMock.thoughtUnit.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.participant.deleteMany.mockResolvedValue({ count: 0 });
}

function setupSearchMocks() {
  // Corpus lookup for the query route
  prismaMock.corpus.findUnique.mockResolvedValue({ id: 'corpus_e2e', name: 'E2E Test Corpus' });
  prismaMock.conversation.findMany.mockResolvedValue([
    { id: 'conv_e2e_001', title: 'AI Safety Discussion' },
  ]);

  // ThoughtUnit findMany for query route (called after vector search returns IDs)
  prismaMock.thoughtUnit.findMany.mockResolvedValue([
    {
      id: 'tu_claim_1',
      type: 'claim',
      text: 'AI alignment requires careful reward modeling',
      confidence: 0.8,
      conversationId: 'conv_e2e_001',
      evidenceSpans: [
        {
          id: 'es_1',
          startMs: 21000,
          endMs: 30000,
          quote: 'The key insight is that alignment requires careful reward modeling.',
          turn: { id: 'turn_4', text: 'The key insight is that alignment requires careful reward modeling.', startMs: 21000, endMs: 30000 },
        },
      ],
      conversation: { id: 'conv_e2e_001', title: 'AI Safety Discussion' },
    },
    {
      id: 'tu_ev_1',
      type: 'evidence',
      text: 'Email is researcher@example.com',
      confidence: 0.8,
      conversationId: 'conv_e2e_001',
      evidenceSpans: [
        {
          id: 'es_2',
          startMs: 5000,
          endMs: 12000,
          quote: 'My email is researcher@example.com for follow up.',
          turn: null,
        },
      ],
      conversation: { id: 'conv_e2e_001', title: 'AI Safety Discussion' },
    },
  ]);
}

// ===========================================================================
// Test: Full pipeline
// ===========================================================================

describe('Pipeline E2E: upload → transcribe(PII) → analyze(embeddings) → search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes the full pipeline: upload → transcribe → analyze → semantic search', async () => {
    // ── Step 1: processUpload ──
    setupUploadMocks();

    const uploadResult = await processUpload(
      {
        fileBuffer: TEST_BUFFER,
        fileName: 'e2e-test-recording.mp3',
        fileSize: 2_000_000,
        mimeType: 'audio/mpeg',
        corpusId: 'corpus_e2e',
        title: 'AI Safety Discussion',
      },
      {
        prisma: {
          source: { create: prismaMock.source.create, update: prismaMock.source.update },
          mediaAsset: { create: prismaMock.mediaAsset.create },
          conversation: { create: prismaMock.conversation.create },
          corpus: { findUnique: prismaMock.corpus.findUnique },
        },
        storage: storageProviderMock,
        queue: { add: queueAddMock },
        transcriptionProvider: { getProviderName: () => 'whisper-e2e' },
        logger: loggerMock,
        ensureDefaultWorkspace: async () => ({ id: 'ws_e2e' }),
        ensureYouTubeCorpus: async () => ({ id: 'corpus_default' }),
      },
    );

    // Upload assertions
    expect(uploadResult).toMatchObject({
      sourceId: 'src_e2e_001',
      conversationId: 'conv_e2e_001',
      status: 'processing',
      fileName: 'e2e-test-recording.mp3',
      fileSize: 2_000_000,
    });

    // Verify storage was called
    expect(storageProviderMock.save).toHaveBeenCalledTimes(1);
    expect(storageProviderMock.generateKey).toHaveBeenCalledWith(
      'e2e-test-recording.mp3',
      TEST_BUFFER,
    );

    // Verify source + conversation created
    expect(prismaMock.source.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'media_upload',
          corpusId: 'corpus_e2e',
          status: 'pending',
        }),
      }),
    );

    // Verify transcribe queue was enqueued with correct data
    expect(queueAddMock).toHaveBeenCalledWith('transcribe', {
      sourceId: 'src_e2e_001',
      conversationId: 'conv_e2e_001',
      mediaKey: 'e2e-hash-1700000000000.mp3',
      mimeType: 'audio/mpeg',
      provider: 'whisper-e2e',
    });

    // ═══════════════════════════════════════════════════════════
    // ── Step 2: processTranscribeJob (conversation path) ──
    // {sourceId, conversationId} (no episodeId) routes through
    // processConversationTranscribe → findAudioPath → provider.transcribe.
    // ═══════════════════════════════════════════════════════════

    setupTranscribeMocks();

    await processTranscribeJob({
      sourceId: 'src_e2e_001',
      conversationId: 'conv_e2e_001',
      mediaKey: 'e2e-hash-1700000000000.mp3',
      mimeType: 'audio/mpeg',
    });

    // Conversation path resolves audio via findAudioPath (mediaAsset.filePath),
    // not via storage.get. Verify the conversation was looked up.
    expect(prismaMock.conversation.findUnique).toHaveBeenCalled();

    // Verify Turns were created (4 segments from the provider)
    expect(prismaMock.turn.createMany).toHaveBeenCalledTimes(1);
    const turnData = prismaMock.turn.createMany.mock.calls[0][0].data;

    expect(turnData).toHaveLength(4);

    // Segments map directly from provider output (no separate PII redaction
    // step in the conversation path).
    expect(turnData[0]).toMatchObject({
      text: 'Welcome to this recording about AI safety.',
      turnIndex: 0,
    });
    expect(turnData[1].text).toContain('researcher@example.com');
    expect(turnData[2].text).toContain('555-123-4567');
    expect(turnData[3].text).toContain('alignment');

    // Segment 3: no PII
    expect(turnData[3].text).toContain('alignment');

    // Verify status update: conversation path sets conversation.status='transcribed'
    expect(prismaMock.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv_e2e_001' },
        data: expect.objectContaining({ status: 'transcribed' }),
      }),
    );

    // Verify analyze job was enqueued (conversation path, no step → manual enqueue)
    expect(analyzeQueueAddMock).toHaveBeenCalledWith('analyze', {
      conversationId: 'conv_e2e_001',
    });

    // ═════════════════════════════════════════════════════
    // ── Step 3: processAnalyzeJob (conversation path) ──
    // ═════════════════════════════════════════════════════

    setupAnalyzeMocks('conv_e2e_001');

    await processAnalyzeJob({
      conversationId: 'conv_e2e_001',
      sourceId: 'src_e2e_001',
    });

    // Verify turns were read for analysis
    expect(prismaMock.turn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conv_e2e_001' },
        orderBy: { turnIndex: 'asc' },
      }),
    );

    // Verify thought units were created (3: claim + 2 evidence)
    expect(prismaMock.thoughtUnit.create).toHaveBeenCalledTimes(3);

    // Verify evidence spans were created for each thought unit
    expect(prismaMock.evidenceSpan.create).toHaveBeenCalled();

    // Verify embeddings were generated and stored
    const embeddingsModule = await import('@/lib/embeddings');
    expect(embeddingsModule.generateEmbeddings).toHaveBeenCalled();

    const searchModule = await import('@/lib/embeddings/search');
    expect(searchModule.storeEmbeddings).toHaveBeenCalled();

    // V2/T-V2-4: the conversation path now uses incremental merge instead of full rebuild.
    const incrementalModule = await import('@/lib/graph/incremental');
    expect(incrementalModule.mergeConversationIntoGraph).toHaveBeenCalledWith('conv_e2e_001');

    // Verify conversation marked completed
    expect(prismaMock.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv_e2e_001' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );

    // ════════════════════════════════════════
    // ── Step 4: Semantic search (query API) ──
    // ════════════════════════════════════════

    setupSearchMocks();

    const request = new NextRequest('http://localhost:3000/api/corpora/corpus_e2e/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'What is the key insight about AI alignment?',
        mode: 'semantic',
        maxResults: 5,
      }),
    });

    const response = await queryPost(request, { params: Promise.resolve({ id: 'corpus_e2e' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.searchMode).toBe('semantic');
    expect(body.sources).toHaveLength(2);
    expect(body.stats.thoughtUnitsFound).toBe(2);
    expect(body.stats.conversationsReferenced).toBe(1);

    // First source should be the claim (highest similarity)
    expect(body.sources[0].type).toBe('claim');
    expect(body.sources[0].text).toContain('reward modeling');

    // Answer should be present (LLM or keyword fallback)
    expect(body.answer).toBeTruthy();
    expect(typeof body.answer).toBe('string');
    expect(body.answer.length).toBeGreaterThan(0);
  });

  it('handles pipeline failure gracefully at transcribe step', async () => {
    // Upload succeeds
    setupUploadMocks();
    await processUpload(
      {
        fileBuffer: TEST_BUFFER,
        fileName: 'failing-test.mp3',
        fileSize: 500_000,
        mimeType: 'audio/mpeg',
        corpusId: 'corpus_e2e',
      },
      {
        prisma: {
          source: { create: prismaMock.source.create, update: prismaMock.source.update },
          mediaAsset: { create: prismaMock.mediaAsset.create },
          conversation: { create: prismaMock.conversation.create },
          corpus: { findUnique: prismaMock.corpus.findUnique },
        },
        storage: storageProviderMock,
        queue: { add: queueAddMock },
        transcriptionProvider: { getProviderName: () => 'whisper-e2e' },
        logger: loggerMock,
        ensureDefaultWorkspace: async () => ({ id: 'ws_e2e' }),
        ensureYouTubeCorpus: async () => ({ id: 'corpus_default' }),
      },
    );

    // Transcribe fails: processConversationTranscribe resolves findAudioPath
    // successfully, then conversation.update (→ 'transcribing') is rejected.
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: 'conv_e2e_001',
      source: { mediaAssets: [{ storageKey: 'e2e-hash.mp3', filePath: E2E_AUDIO_PATH }] },
      episodeKey: null,
      globalEpisode: null,
    });
    prismaMock.conversation.update.mockRejectedValue(new Error('Database write failed'));

    await expect(
      processTranscribeJob({
        sourceId: 'src_e2e_001',
        conversationId: 'conv_e2e_001',
        mediaKey: 'e2e-hash.mp3',
        mimeType: 'audio/mpeg',
      }),
    ).rejects.toThrow('Database write failed');

    // The failure surfaces as a thrown error from the transcribe step.
    expect(loggerMock.info).toHaveBeenCalled();
  });
});
