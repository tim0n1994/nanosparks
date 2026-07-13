/**
 * Tests for src/lib/upload/service.ts
 *
 * processUpload is a pure orchestration function with injected dependencies.
 * These tests verify:
 * - Validation (bad mime, too large)
 * - Successful upload with default corpus
 * - Successful upload with specific corpus
 * - Corpus not found
 * - Orchestration call order and data flow
 */

import { describe, it, expect, vi } from 'vitest';
import { processUpload, UploadError, ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from '@/lib/upload/service';
import type { UploadDeps } from '@/lib/upload/service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_BUFFER = Buffer.from('fake audio content', 'utf-8');

function createMockDeps(overrides?: Partial<UploadDeps>): UploadDeps {
  const generateKey = vi.fn(() => 'abc123-1700000000000.mp3');
  const storageSave = vi.fn(async () => ({ key: 'abc123-1700000000000.mp3', url: '/api/storage/abc123-1700000000000.mp3', size: TEST_BUFFER.length }));
  const sourceCreate = vi.fn(async () => ({ id: 'src_abcdef123456' }));
  const sourceUpdate = vi.fn(async () => ({}));
  const mediaAssetCreate = vi.fn(async () => ({}));
  const conversationCreate = vi.fn(async () => ({ id: 'conv_abcdef123456' }));
  const corpusFindUnique = vi.fn(async () => ({ id: 'corpus_default' }));
  const queueAdd = vi.fn(async () => ({ id: 'job_123' }));
  const getProviderName = vi.fn(() => 'whisper-local');
  const loggerInfo = vi.fn();
  const loggerError = vi.fn();
  const ensureDefaultWorkspace = vi.fn(async () => ({ id: 'ws_default' }));
  const ensureYouTubeCorpus = vi.fn(async () => ({ id: 'corpus_default' }));

  return {
    prisma: {
      source: { create: sourceCreate, update: sourceUpdate },
      mediaAsset: { create: mediaAssetCreate },
      conversation: { create: conversationCreate },
      corpus: { findUnique: corpusFindUnique },
    },
    storage: {
      generateKey,
      save: storageSave,
    },
    queue: { add: queueAdd },
    transcriptionProvider: { getProviderName },
    logger: { info: loggerInfo, error: loggerError },
    ensureDefaultWorkspace,
    ensureYouTubeCorpus,
    ...overrides,
  };
}

function validInput(overrides?: Partial<{
  fileBuffer: Buffer;
  fileName: string;
  fileSize: number;
  mimeType: string;
  corpusId: string;
  title: string;
}>) {
  return {
    fileBuffer: TEST_BUFFER,
    fileName: 'test-recording.mp3',
    fileSize: 1_024_000, // 1 MB
    mimeType: 'audio/mpeg',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('processUpload — validation', () => {
  it('throws for unsupported mime type', async () => {
    const deps = createMockDeps();

    await expect(processUpload(validInput({ mimeType: 'application/pdf' }), deps))
      .rejects.toThrow(UploadError);
    await expect(processUpload(validInput({ mimeType: 'application/pdf' }), deps))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Unsupported file type') });
  });

  it('rejects 501MB file', async () => {
    const deps = createMockDeps();

    await expect(processUpload(validInput({ fileSize: 501 * 1024 * 1024 }), deps))
      .rejects.toThrow(UploadError);
    await expect(processUpload(validInput({ fileSize: 501 * 1024 * 1024 }), deps))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('too large') });
  });

  it('accepts exactly 500MB file', async () => {
    const deps = createMockDeps();

    const result = await processUpload(validInput({ fileSize: MAX_FILE_SIZE }), deps);

    expect(result.status).toBe('processing');
  });

  it('accepts any audio/* mime type', async () => {
    const deps = createMockDeps();

    const result = await processUpload(validInput({ mimeType: 'audio/x-custom-codec' }), deps);

    expect(result.status).toBe('processing');
  });

  it('accepts all allowed mime types', async () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      const deps = createMockDeps();
      const result = await processUpload(validInput({ mimeType: mime }), deps);
      expect(result.status).toBe('processing');
    }
  });
});

// ---------------------------------------------------------------------------
// success cases
// ---------------------------------------------------------------------------

describe('processUpload — success', () => {
  it('returns sourceId, conversationId, status processing', async () => {
    const deps = createMockDeps();

    const result = await processUpload(validInput(), deps);

    expect(result).toEqual({
      sourceId: 'src_abcdef123456',
      conversationId: 'conv_abcdef123456',
      status: 'processing',
      fileName: 'test-recording.mp3',
      fileSize: 1_024_000,
    });
  });

  it('uses the provided title for conversation', async () => {
    const deps = createMockDeps();
    const conversationCreate = vi.fn(async () => ({ id: 'conv_custom' }));
    deps.prisma.conversation.create = conversationCreate;

    await processUpload(validInput({ title: 'My Podcast Episode' }), deps);

    expect(conversationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'My Podcast Episode' }),
      }),
    );
  });

  it('falls back to fileName when no title provided', async () => {
    const deps = createMockDeps();
    const conversationCreate = vi.fn(async () => ({ id: 'conv_fallback' }));
    deps.prisma.conversation.create = conversationCreate;

    await processUpload(validInput({ title: undefined }), deps);

    expect(conversationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'test-recording.mp3' }),
      }),
    );
  });

  it('uses default corpus when no corpusId provided', async () => {
    const deps = createMockDeps();
    const corpusCreate = vi.fn(async () => ({ id: 'corpus_default' }));
    deps.ensureYouTubeCorpus = corpusCreate;

    await processUpload(validInput({ corpusId: undefined }), deps);

    expect(corpusCreate).toHaveBeenCalledOnce();
    expect(deps.prisma.corpus.findUnique).not.toHaveBeenCalled();
  });

  it('uses provided corpus when corpusId is given', async () => {
    const deps = createMockDeps();
    const corpusFindUnique = vi.fn(async () => ({ id: 'corpus_specific' }));
    deps.prisma.corpus.findUnique = corpusFindUnique;

    await processUpload(validInput({ corpusId: 'corpus_specific' }), deps);

    expect(corpusFindUnique).toHaveBeenCalledWith({ where: { id: 'corpus_specific' } });
    expect(deps.ensureYouTubeCorpus).not.toHaveBeenCalled();
  });

  it('uses workspace from ensureDefaultWorkspace', async () => {
    const deps = createMockDeps();
    const workspaceMock = vi.fn(async () => ({ id: 'ws_custom' }));
    deps.ensureDefaultWorkspace = workspaceMock;

    await processUpload(validInput({ corpusId: undefined }), deps);

    expect(workspaceMock).toHaveBeenCalledOnce();
    // ensureYouTubeCorpus called with that workspace id
    expect(deps.ensureYouTubeCorpus).toHaveBeenCalledWith('ws_custom');
  });

  it('sets mediaType to video for video mime types', async () => {
    const deps = createMockDeps();
    const mediaAssetCreate = vi.fn(async () => ({}));
    deps.prisma.mediaAsset.create = mediaAssetCreate;

    await processUpload(validInput({ mimeType: 'video/mp4' }), deps);

    expect(mediaAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaType: 'video' }),
      }),
    );
  });

  it('sets mediaType to audio for non-video mime types', async () => {
    const deps = createMockDeps();
    const mediaAssetCreate = vi.fn(async () => ({}));
    deps.prisma.mediaAsset.create = mediaAssetCreate;

    await processUpload(validInput(), deps);

    expect(mediaAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaType: 'audio' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// error cases
// ---------------------------------------------------------------------------

describe('processUpload — errors', () => {
  it('throws UploadError(404) when corpus not found', async () => {
    const deps = createMockDeps();
    deps.prisma.corpus.findUnique = vi.fn(async () => null);

    await expect(processUpload(validInput({ corpusId: 'nonexistent' }), deps))
      .rejects.toThrow(UploadError);
    await expect(processUpload(validInput({ corpusId: 'nonexistent' }), deps))
      .rejects.toMatchObject({ statusCode: 404, message: 'Corpus not found' });
  });
});

// ---------------------------------------------------------------------------
// orchestration order
// ---------------------------------------------------------------------------

describe('processUpload — orchestration order', () => {
  it('calls deps in correct sequence (generateKey → save → ensureWorkspace → corpus → source → mediaAsset → conversation → source.update → queue.add)', async () => {
    const callLog: string[] = [];

    const deps: UploadDeps = {
      prisma: {
        source: {
          create: vi.fn(async (args) => {
            callLog.push('source.create');
            expect(args.data).toMatchObject({
              kind: 'media_upload',
              uri: 'key_order_001.mp3',
              sourceType: 'upload',
              corpusId: 'corpus_default',
              consentStatus: 'granted',
              status: 'pending',
            });
            return { id: 'src_order_001' };
          }),
          update: vi.fn(async (args) => {
            callLog.push('source.update');
            expect(args).toMatchObject({
              where: { id: 'src_order_001' },
              data: { status: 'processing' },
            });
          }),
        },
        mediaAsset: {
          create: vi.fn(async (args) => {
            callLog.push('mediaAsset.create');
            expect(args.data).toMatchObject({
              sourceId: 'src_order_001',
              mediaType: 'audio',
              storageKey: 'key_order_001.mp3',
              mimeType: 'audio/mpeg',
              fileSize: 1_024_000,
            });
          }),
        },
        conversation: {
          create: vi.fn(async (args) => {
            callLog.push('conversation.create');
            expect(args.data).toMatchObject({
              title: 'order-test.mp3',
              sourceId: 'src_order_001',
              corpusId: 'corpus_default',
              status: 'pending',
            });
            return { id: 'conv_order_001' };
          }),
        },
        corpus: {
          findUnique: vi.fn(async () => {
            callLog.push('corpus.findUnique');
            return { id: 'corpus_default' };
          }),
        },
      },
      storage: {
        generateKey: vi.fn((name: string, _buf: Buffer) => {
          callLog.push('storage.generateKey');
          expect(name).toBe('order-test.mp3');
          return 'key_order_001.mp3';
        }),
        save: vi.fn(async (key: string, _buf: Buffer, mime: string) => {
          callLog.push('storage.save');
          expect(key).toBe('key_order_001.mp3');
          expect(mime).toBe('audio/mpeg');
          return { key, url: '/api/storage/key_order_001.mp3', size: TEST_BUFFER.length };
        }),
      },
      queue: {
        add: vi.fn(async (name: string, data: Record<string, unknown>) => {
          callLog.push('queue.add');
          expect(name).toBe('transcribe');
          expect(data).toMatchObject({
            sourceId: 'src_order_001',
            conversationId: 'conv_order_001',
            mediaKey: 'key_order_001.mp3',
            mimeType: 'audio/mpeg',
            provider: 'whisper-custom',
          });
          return { id: 'job_001' };
        }),
      },
      transcriptionProvider: {
        getProviderName: vi.fn(() => {
          callLog.push('transcriptionProvider.getProviderName');
          return 'whisper-custom';
        }),
      },
      logger: {
        info: vi.fn((msg: string, _meta?: Record<string, unknown>) => {
          callLog.push('logger.info');
          expect(msg).toContain('src_order_001');
          expect(msg).toContain('conv_order_001');
        }),
        error: vi.fn(),
      },
      ensureDefaultWorkspace: vi.fn(async () => {
        callLog.push('ensureDefaultWorkspace');
        return { id: 'ws_order' };
      }),
      ensureYouTubeCorpus: vi.fn(async (wsId: string) => {
        callLog.push('ensureYouTubeCorpus');
        expect(wsId).toBe('ws_order');
        return { id: 'corpus_default' };
      }),
    };

    await processUpload({
      fileBuffer: TEST_BUFFER,
      fileName: 'order-test.mp3',
      fileSize: 1_024_000,
      mimeType: 'audio/mpeg',
      corpusId: 'corpus_default',
    }, deps);

    expect(callLog).toEqual([
      'storage.generateKey',
      'storage.save',
      'ensureDefaultWorkspace',
      'corpus.findUnique',
      'source.create',
      'mediaAsset.create',
      'conversation.create',
      'transcriptionProvider.getProviderName',
      'source.update',
      'queue.add',
      'logger.info',
    ]);
  });
});
