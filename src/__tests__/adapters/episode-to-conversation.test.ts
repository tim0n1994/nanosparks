/**
 * Tests for Episode → Conversation Adapter
 *
 * Tests findUnmappedEpisodeIds, createFromEpisode, ensureDefaultWorkspace,
 * ensureYouTubeCorpus, and backfillAllEpisodes with mocked Prisma client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted() to avoid hoisting ReferenceError with vi.mock
const prismaMock = vi.hoisted(() => ({
  source: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  conversation: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  episode: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  workspace: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  corpus: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  turn: {
    createMany: vi.fn(),
  },
  participant: {
    create: vi.fn(),
    createMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

// Mock logger to avoid noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Now import the module under test
import {
  findUnmappedEpisodeIds,
  createFromEpisode,
  ensureDefaultWorkspace,
  ensureYouTubeCorpus,
  updateConversationStatus,
  backfillAllEpisodes,
} from '@/lib/adapters/episode-to-conversation';

describe('findUnmappedEpisodeIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns episode IDs that have no source mapping', async () => {
    prismaMock.source.findMany.mockResolvedValue([
      { episodeId: 'ep1' },
      { episodeId: 'ep2' },
    ]);
    prismaMock.episode.findMany.mockResolvedValue([
      { id: 'ep1' },
      { id: 'ep2' },
      { id: 'ep3' },
      { id: 'ep4' },
    ]);

    const result = await findUnmappedEpisodeIds();

    expect(result).toEqual(['ep3', 'ep4']);
    expect(prismaMock.source.findMany).toHaveBeenCalledWith({
      where: { episodeId: { not: null } },
      select: { episodeId: true },
    });
  });

  it('returns all episode IDs when none are mapped', async () => {
    prismaMock.source.findMany.mockResolvedValue([]);
    prismaMock.episode.findMany.mockResolvedValue([
      { id: 'ep1' },
      { id: 'ep2' },
    ]);

    const result = await findUnmappedEpisodeIds();

    expect(result).toEqual(['ep1', 'ep2']);
  });

  it('returns empty array when all episodes are mapped', async () => {
    prismaMock.source.findMany.mockResolvedValue([
      { episodeId: 'ep1' },
      { episodeId: 'ep2' },
    ]);
    prismaMock.episode.findMany.mockResolvedValue([
      { id: 'ep1' },
      { id: 'ep2' },
    ]);

    const result = await findUnmappedEpisodeIds();

    expect(result).toEqual([]);
  });
});

describe('ensureDefaultWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing workspace if one exists', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws_123', name: 'Default Workspace' });

    const result = await ensureDefaultWorkspace();

    expect(result).toEqual({ id: 'ws_123' });
    expect(prismaMock.workspace.create).not.toHaveBeenCalled();
  });

  it('creates a new workspace if none exists', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(null);
    prismaMock.workspace.create.mockResolvedValue({ id: 'ws_new', name: 'Default Workspace' });

    const result = await ensureDefaultWorkspace();

    expect(result).toEqual({ id: 'ws_new' });
    expect(prismaMock.workspace.create).toHaveBeenCalledWith({
      data: { name: 'Default Workspace' },
    });
  });
});

describe('ensureYouTubeCorpus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing corpus if one exists', async () => {
    prismaMock.corpus.findFirst.mockResolvedValue({
      id: 'corpus_123',
      name: 'YouTube Imports',
      workspaceId: 'ws_123',
    });

    const result = await ensureYouTubeCorpus('ws_123');

    expect(result).toEqual({ id: 'corpus_123' });
    expect(prismaMock.corpus.findFirst).toHaveBeenCalledWith({
      where: { name: 'YouTube Imports', workspaceId: 'ws_123' },
    });
    expect(prismaMock.corpus.create).not.toHaveBeenCalled();
  });

  it('creates a new corpus if none exists', async () => {
    prismaMock.corpus.findFirst.mockResolvedValue(null);
    prismaMock.corpus.create.mockResolvedValue({
      id: 'corpus_new',
      name: 'YouTube Imports',
      workspaceId: 'ws_123',
    });

    const result = await ensureYouTubeCorpus('ws_123');

    expect(result).toEqual({ id: 'corpus_new' });
    expect(prismaMock.corpus.create).toHaveBeenCalledWith({
      data: {
        name: 'YouTube Imports',
        description: 'Auto-imported YouTube videos',
        workspaceId: 'ws_123',
      },
    });
  });
});

describe('updateConversationStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates conversation status when conversation exists', async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({ id: 'conv_123' });

    await updateConversationStatus('ep_123', 'completed');

    expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
      where: { episodeId: 'ep_123' },
    });
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_123' },
      data: { status: 'completed' },
    });
  });

  it('does nothing when no conversation exists for episode', async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await updateConversationStatus('ep_unknown', 'failed');

    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
  });
});

describe('createFromEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing mapping if source already exists', async () => {
    prismaMock.source.findUnique.mockResolvedValue({
      id: 'src_existing',
      corpusId: 'corpus_existing',
      episodeId: 'ep_existing',
    });
    prismaMock.conversation.findFirst.mockResolvedValue({
      id: 'conv_existing',
    });

    const result = await createFromEpisode('ep_existing');

    expect(result).toEqual({
      sourceId: 'src_existing',
      conversationId: 'conv_existing',
      corpusId: 'corpus_existing',
      workspaceId: '',
    });
    expect(prismaMock.episode.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when episode does not exist', async () => {
    prismaMock.source.findUnique.mockResolvedValue(null);
    prismaMock.episode.findUnique.mockResolvedValue(null);

    const result = await createFromEpisode('ep_nonexistent');

    expect(result).toBeNull();
  });

  it('creates source, conversation, turns, and participants for a COMPLETED episode', async () => {
    prismaMock.source.findUnique.mockResolvedValue(null);
    prismaMock.episode.findUnique.mockResolvedValue({
      id: 'ep_new',
      youtubeId: 'dQw4w9WgXcQ',
      title: 'Test Episode',
      status: 'COMPLETED',
      transcript: [
        { start: 0.0, end: 5.0, text: 'Hello world', speakerId: 'speaker_1' },
      ],
      analysis: {
        speakers: [
          { id: 'speaker_1', name: 'Speaker One', role: 'host' },
        ],
      },
      channel: { id: 'ch_1', name: 'Test Channel' },
    });

    // Mock workspace + corpus
    prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws_1', name: 'Default Workspace' });
    prismaMock.corpus.findFirst.mockResolvedValue({
      id: 'corpus_1',
      name: 'YouTube Imports',
      workspaceId: 'ws_1',
    });

    // Mock source and conversation creation
    prismaMock.source.create.mockResolvedValue({
      id: 'src_new',
      corpusId: 'corpus_1',
    });
    prismaMock.conversation.create.mockResolvedValue({
      id: 'conv_new',
    });
    prismaMock.turn.createMany.mockResolvedValue({ count: 1 });
    prismaMock.participant.create.mockResolvedValue({
      id: 'part_1',
      conversationId: 'conv_new',
      name: 'Speaker One',
    });

    const result = await createFromEpisode('ep_new');

    expect(result).toEqual({
      sourceId: 'src_new',
      conversationId: 'conv_new',
      corpusId: 'corpus_1',
      workspaceId: 'ws_1',
    });

    // Verify source was created with YouTube metadata
    expect(prismaMock.source.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'youtube_url',
          sourceType: 'youtube',
          episodeId: 'ep_new',
          status: 'completed',
        }),
      }),
    );

    // Verify turns were created from transcript segments
    expect(prismaMock.turn.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          conversationId: 'conv_new',
          startMs: 0,
          endMs: 5000,
          text: 'Hello world',
          turnIndex: 0,
        }),
      ]),
    });
  });

  it('handles episode with empty transcript gracefully', async () => {
    prismaMock.source.findUnique.mockResolvedValue(null);
    prismaMock.episode.findUnique.mockResolvedValue({
      id: 'ep_no_transcript',
      youtubeId: 'test123',
      title: 'No Transcript',
      status: 'COMPLETED',
      transcript: null,
      analysis: null,
      channel: null,
    });

    prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws_1', name: 'Default Workspace' });
    prismaMock.corpus.findFirst.mockResolvedValue({ id: 'corpus_1', name: 'YouTube Imports', workspaceId: 'ws_1' });
    prismaMock.source.create.mockResolvedValue({ id: 'src_no_tr', corpusId: 'corpus_1' });
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_no_tr' });

    const result = await createFromEpisode('ep_no_transcript');

    expect(result).not.toBeNull();
    expect(prismaMock.turn.createMany).not.toHaveBeenCalled();
    expect(prismaMock.participant.create).not.toHaveBeenCalled();
  });
});

describe('backfillAllEpisodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('backfills all unmapped episodes and returns count', async () => {
    prismaMock.source.findMany.mockResolvedValue([]);
    prismaMock.episode.findMany.mockResolvedValue([
      { id: 'ep1' },
      { id: 'ep2' },
    ]);

    // Mock createFromEpisode internals
    prismaMock.episode.findUnique.mockResolvedValue({
      id: 'ep1',
      youtubeId: 'test',
      title: 'Test',
      status: 'COMPLETED',
      transcript: [],
      analysis: null,
      channel: null,
    });
    prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws_1', name: 'Default Workspace' });
    prismaMock.corpus.findFirst.mockResolvedValue({ id: 'corpus_1', name: 'YouTube Imports', workspaceId: 'ws_1' });
    prismaMock.source.create.mockResolvedValue({ id: 'src_new', corpusId: 'corpus_1' });
    prismaMock.conversation.create.mockResolvedValue({ id: 'conv_new' });

    const count = await backfillAllEpisodes();

    expect(count).toBe(2);
    expect(prismaMock.source.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.conversation.create).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when no unmapped episodes exist', async () => {
    prismaMock.source.findMany.mockResolvedValue([{ episodeId: 'ep1' }]);
    prismaMock.episode.findMany.mockResolvedValue([{ id: 'ep1' }]);

    const count = await backfillAllEpisodes();

    expect(count).toBe(0);
    expect(prismaMock.source.create).not.toHaveBeenCalled();
  });
});
