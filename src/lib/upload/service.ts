/**
 * Upload Service
 *
 * Pure orchestration logic for file uploads, testable without Next.js.
 * The route handler calls this function with injected dependencies.
 */

export class UploadError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UploadError';
    this.statusCode = statusCode;
  }
}

export interface UploadInput {
  fileBuffer: Buffer;
  fileName: string;
  fileSize: number;
  mimeType: string;
  corpusId?: string;
  title?: string;
}

export interface UploadDeps {
  prisma: {
    source: {
      create: (args: { data: any }) => Promise<{ id: string }>;
      update: (args: { where: { id: string }; data: any }) => Promise<unknown>;
    };
    mediaAsset: {
      create: (args: { data: any }) => Promise<unknown>;
    };
    conversation: {
      create: (args: { data: any }) => Promise<{ id: string }>;
    };
    corpus: {
      findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
    };
  };
  storage: {
    generateKey: (name: string, buffer: Buffer) => string;
    save: (key: string, buffer: Buffer, mimeType: string) => Promise<{ key: string; url: string; size: number }>;
  };
  queue: {
    add: (name: string, data: Record<string, unknown>) => Promise<{ id?: string }>;
  };
  transcriptionProvider: {
    getProviderName: () => string;
  };
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  ensureDefaultWorkspace: () => Promise<{ id: string }>;
  ensureYouTubeCorpus: (workspaceId: string) => Promise<{ id: string }>;
}

export interface UploadResult {
  sourceId: string;
  conversationId: string;
  status: string;
  fileName: string;
  fileSize: number;
}

export const ALLOWED_MIME_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4',
  'audio/x-m4a', 'audio/flac', 'audio/webm',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
];

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

/**
 * Process a file upload through the full pipeline:
 * validate → store → create records → enqueue transcribe.
 *
 * Pure orchestration: no HTTP/Next.js dependencies, accepts deps as injection.
 * Throws UploadError with appropriate status codes for known failure modes.
 */
export async function processUpload(
  input: UploadInput,
  deps: UploadDeps,
): Promise<UploadResult> {
  // --- Validate file type ---
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType) && !input.mimeType.startsWith('audio/')) {
    throw new UploadError(
      `Unsupported file type: ${input.mimeType}. Allowed: audio/*, video/mp4, video/webm, video/ogg`,
      400,
    );
  }

  // --- Validate file size ---
  if (input.fileSize > MAX_FILE_SIZE) {
    throw new UploadError('File too large. Maximum size is 500MB.', 400);
  }

  // --- 1. Save to storage ---
  const key = deps.storage.generateKey(input.fileName, input.fileBuffer);
  await deps.storage.save(key, input.fileBuffer, input.mimeType);

  // --- 2. Resolve workspace + corpus ---
  const workspace = await deps.ensureDefaultWorkspace();

  let corpusId: string;
  if (input.corpusId) {
    const corpus = await deps.prisma.corpus.findUnique({ where: { id: input.corpusId } });
    if (!corpus) {
      throw new UploadError('Corpus not found', 404);
    }
    corpusId = corpus.id;
  } else {
    const corpus = await deps.ensureYouTubeCorpus(workspace.id);
    corpusId = corpus.id;
  }

  // --- 3. Create Source record ---
  const source = await deps.prisma.source.create({
    data: {
      kind: 'media_upload',
      uri: key,
      sourceType: 'upload',
      corpusId,
      consentStatus: 'granted',
      visibility: 'private',
      retentionPolicy: 'keep',
      status: 'pending',
    },
  });

  // --- 4. Create MediaAsset record ---
  await deps.prisma.mediaAsset.create({
    data: {
      sourceId: source.id,
      mediaType: input.mimeType.startsWith('video/') ? 'video' : 'audio',
      storageKey: key,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      retentionPolicy: 'keep',
    },
  });

  // --- 5. Create Conversation record ---
  const conversation = await deps.prisma.conversation.create({
    data: {
      title: input.title || input.fileName,
      sourceId: source.id,
      corpusId,
      episodeKey: null, // uploads never enter the shared cache (privacy boundary, PRD §A1)
      isSharedCache: false,
      status: 'pending',
    },
  });

  // --- 6. Update source to processing ---
  const providerName = deps.transcriptionProvider.getProviderName();
  await deps.prisma.source.update({
    where: { id: source.id },
    data: { status: 'processing' },
  });

  // --- 7. Enqueue transcribe job ---
  await deps.queue.add('transcribe', {
    sourceId: source.id,
    conversationId: conversation.id,
    mediaKey: key,
    mimeType: input.mimeType,
    provider: providerName,
  });

  deps.logger.info(
    `Upload processed: source=${source.id} conversation=${conversation.id} file=${input.fileName}`,
  );

  return {
    sourceId: source.id,
    conversationId: conversation.id,
    status: 'processing',
    fileName: input.fileName,
    fileSize: input.fileSize,
  };
}
