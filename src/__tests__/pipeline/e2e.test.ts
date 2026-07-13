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

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  participant: { createMany: vi.fn(), deleteMany: vi.fn() },
  graphNode: { create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  graphEdge: { create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  analysis: { create: vi.fn() },
  workspace: { findFirst: vi.fn(), create: vi.fn() },
  $queryRawUnsafe: vi.fn(),
  $executeRawUnsafe: vi.fn(),
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
    validateJsonResponse: vi.fn((content: string, schema: any) => {
      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    }),
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

vi.mock('@/lib/prompt-sanitize', () => ({
  sanitizeForPrompt: vi.fn((text: string) => text),
}));

vi.mock('@/lib/graph/builder', () => ({
  rebuildCorpusGraph: vi.fn(async () => ({ nodesCreated: 3, edgesCreated: 2 })),
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
  // Source + conversation status updates
  prismaMock.source.update.mockResolvedValue({});
  prismaMock.conversation.update.mockResolvedValue({});
  // Turn operations
  prismaMock.turn.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.turn.createMany.mockResolvedValue({ count: 4 });
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
    // ── Step 2: processTranscribeJob (upload path with PII) ──
    // ═══════════════════════════════════════════════════════════

    setupTranscribeMocks();

    await processTranscribeJob({
      sourceId: 'src_e2e_001',
      conversationId: 'conv_e2e_001',
      mediaKey: 'e2e-hash-1700000000000.mp3',
      mimeType: 'audio/mpeg',
    });

    // Verify storage was read
    expect(storageProviderMock.get).toHaveBeenCalledWith('e2e-hash-1700000000000.mp3');

    // Verify Turns were created (4 segments × PII redacted)
    expect(prismaMock.turn.createMany).toHaveBeenCalledTimes(1);
    const turnData = prismaMock.turn.createMany.mock.calls[0][0].data;

    expect(turnData).toHaveLength(4);

    // Segment 0: no PII → cleanText same as text
    expect(turnData[0]).toMatchObject({
      text: 'Welcome to this recording about AI safety.',
      turnIndex: 0,
    });
    expect(turnData[0].cleanText).toBeTruthy();

    // Segment 1: email redacted → cleanText differs
    expect(turnData[1].text).toContain('researcher@example.com');
    expect(turnData[1].cleanText).toContain('[REDACTED_EMAIL]');
    expect(turnData[1].cleanText).not.toBe(turnData[1].text);

    // Segment 2: phone redacted → cleanText differs
    expect(turnData[2].text).toContain('555-123-4567');
    expect(turnData[2].cleanText).toContain('[REDACTED_PHONE]');
    expect(turnData[2].cleanText).not.toBe(turnData[2].text);

    // Segment 3: no PII
    expect(turnData[3].text).toContain('alignment');

    // Verify status updates
    expect(prismaMock.source.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'src_e2e_001' },
        data: expect.objectContaining({ status: 'transcribed' }),
      }),
    );

    // Verify analyze job was enqueued
    expect(analyzeQueueAddMock).toHaveBeenCalledWith('analyze', {
      conversationId: 'conv_e2e_001',
      sourceId: 'src_e2e_001',
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

    // Verify graph was rebuilt
    const graphModule = await import('@/lib/graph/builder');
    expect(graphModule.rebuildCorpusGraph).toHaveBeenCalledWith('corpus_e2e');

    // Verify conversation marked completed
    expect(prismaMock.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv_e2e_001' },
        data: { status: 'completed' },
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

    // Transcribe fails
    prismaMock.source.update.mockRejectedValue(new Error('Database write failed'));
    prismaMock.conversation.update.mockRejectedValue(new Error('Database write failed'));

    await expect(
      processTranscribeJob({
        sourceId: 'src_e2e_001',
        conversationId: 'conv_e2e_001',
        mediaKey: 'e2e-hash.mp3',
        mimeType: 'audio/mpeg',
      }),
    ).rejects.toThrow('Database write failed');

    // Verify cleanup was attempted (status updated to failed)
    expect(prismaMock.source.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
