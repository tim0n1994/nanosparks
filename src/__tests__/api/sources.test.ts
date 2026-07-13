/**
 * Tests for POST /api/sources route
 *
 * Tests request validation, segment handling, speaker metadata,
 * and error responses for the transcript import endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Mock external dependencies (all hoisted before static imports) ──

const { prismaMock, analyzeQueueAddMock } = vi.hoisted(() => ({
  prismaMock: {
    corpus: { findUnique: vi.fn() },
    source: { create: vi.fn() },
    conversation: { create: vi.fn(), update: vi.fn() },
    turn: { createMany: vi.fn() },
    participant: { createMany: vi.fn() },
  },
  analyzeQueueAddMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/queue/config', () => ({
  analyzeQueue: { add: analyzeQueueAddMock },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/adapters/episode-to-conversation', () => ({
  ensureDefaultWorkspace: vi.fn().mockResolvedValue({ id: 'ws_default' }),
  ensureYouTubeCorpus: vi.fn().mockResolvedValue({ id: 'corpus_default' }),
}));

// ─── Import route handler (static import — vitest hoists mocks first) ──

import { POST } from '@/app/api/sources/route';

function createMockRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when segments are missing', async () => {
    const request = createMockRequest({});
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Transcript segments are required');
  });

  it('returns 400 when segments array is empty', async () => {
    const request = createMockRequest({ segments: [] });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Transcript segments are required');
  });

  it('creates source and conversation from valid segments', async () => {
    prismaMock.source.create.mockResolvedValue({ id: 'src_new' });
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_new' });
    prismaMock.turn.createMany.mockResolvedValue({ count: 3 });
    analyzeQueueAddMock.mockResolvedValue({ id: 'job_1' });

    const request = createMockRequest({
      segments: [
        { startMs: 0, endMs: 3000, text: 'Hello everyone' },
        { startMs: 3000, endMs: 6000, text: 'Welcome to the meeting' },
        { startMs: 6000, endMs: 10000, text: 'Let us discuss the plan' },
      ],
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('sourceId', 'src_new');
    expect(body).toHaveProperty('conversationId', 'conv_new');
    expect(body).toHaveProperty('status', 'analyzing');

    // Verify turns were created from segments
    expect(prismaMock.turn.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ turnIndex: 0, text: 'Hello everyone' }),
        expect.objectContaining({ turnIndex: 1, text: 'Welcome to the meeting' }),
        expect.objectContaining({ turnIndex: 2, text: 'Let us discuss the plan' }),
      ]),
    });

    // Verify conversation status was updated
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_new' },
      data: { status: 'analyzing' },
    });

    // Verify analyze job was enqueued
    expect(analyzeQueueAddMock).toHaveBeenCalledWith('analyze', {
      conversationId: 'conv_new',
    });
  });

  it('creates participants from speaker metadata', async () => {
    prismaMock.source.create.mockResolvedValue({ id: 'src_speakers' });
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_speakers' });
    prismaMock.turn.createMany.mockResolvedValue({ count: 1 });
    prismaMock.participant.createMany.mockResolvedValue({ count: 2 });
    analyzeQueueAddMock.mockResolvedValue({ id: 'job_2' });

    const request = createMockRequest({
      segments: [
        { startMs: 0, endMs: 1000, text: 'Hello', speakerLabel: 'A' },
      ],
      speakers: [
        { name: 'Alice', role: 'moderator', label: 'A' },
        { name: 'Bob', role: 'participant', label: 'B' },
      ],
    });

    const response = await POST(request);

    expect(response.status).toBe(201);

    // Verify participants were created
    expect(prismaMock.participant.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: 'Alice', role: 'moderator', speakerLabel: 'A' }),
        expect.objectContaining({ name: 'Bob', role: 'participant', speakerLabel: 'B' }),
      ]),
    });
  });

  it('uses default corpus when corpusId is not provided', async () => {
    prismaMock.source.create.mockResolvedValue({ id: 'src_default_corpus' });
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_default' });
    prismaMock.turn.createMany.mockResolvedValue({ count: 1 });
    analyzeQueueAddMock.mockResolvedValue({ id: 'job_3' });

    const request = createMockRequest({
      segments: [
        { startMs: 0, endMs: 1000, text: 'Test' },
      ],
    });

    const response = await POST(request);

    expect(response.status).toBe(201);

    // Source should use the default corpus
    expect(prismaMock.source.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          corpusId: 'corpus_default',
        }),
      }),
    );
  });

  it('returns 404 when specified corpus does not exist', async () => {
    prismaMock.corpus.findUnique.mockResolvedValue(null);

    const request = createMockRequest({
      corpusId: 'nonexistent',
      segments: [{ startMs: 0, endMs: 1000, text: 'Test' }],
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('Corpus not found');
  });

  it('generates a title from source ID when not provided', async () => {
    prismaMock.source.create.mockResolvedValue({ id: 'src_abcdef123456' });
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_default' });
    prismaMock.turn.createMany.mockResolvedValue({ count: 1 });
    analyzeQueueAddMock.mockResolvedValue({ id: 'job_4' });

    const request = createMockRequest({
      segments: [{ startMs: 0, endMs: 1000, text: 'Test' }],
    });

    await POST(request);

    // Conversation title should be derived from source ID
    expect(prismaMock.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: expect.stringContaining('Transcript src_ab'),
        }),
      }),
    );
  });

  it('handles server errors gracefully', async () => {
    prismaMock.source.create.mockRejectedValue(new Error('Database connection failed'));

    const request = createMockRequest({
      segments: [{ startMs: 0, endMs: 1000, text: 'Test' }],
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('Source creation failed');
  });
});
