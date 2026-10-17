/**
 * POST /api/upload
 *
 * Upload audio/video files for transcription and analysis.
 * Accepts multipart/form-data with a file and optional corpusId.
 *
 * Flow:
 * 1. Receive file from FormData
 * 2. Validate → delegate to processUpload service
 * 3. Return result or error
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createStorageProvider } from '@/lib/storage/provider';
import { createTranscriptionProvider } from '@/lib/transcription/factory';
import { ensureUserCorpus } from '@/lib/resolvers/user-corpus';
import { transcribeQueue } from '@/lib/queue/config';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { logger } from '@/lib/logger';
import { processUpload, UploadError, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from '@/lib/upload/service';
import { isFlagOn } from '@/lib/feature-flags';

export async function POST(request: NextRequest) {
  try {
    if (!(await isFlagOn('upload_media'))) {
      return NextResponse.json({ error: '媒体上传功能已关闭' }, { status: 403 });
    }
    // Resolve the uploading user (uploads are always private + per-user corpus, PRD §A1).
    let userId = 'dev-user';
    if (isValidClerkKey) {
      const { userId: clerkUserId } = await auth();
      if (!clerkUserId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = clerkUserId;
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await processUpload(
      {
        fileBuffer: buffer,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        corpusId: (formData.get('corpusId') as string) || undefined,
        title: (formData.get('title') as string) || undefined,
      },
      {
        prisma,
        storage: createStorageProvider(),
        queue: transcribeQueue,
        transcriptionProvider: createTranscriptionProvider(),
        logger,
        // Per-user corpus: uploads land in the user's own "My Library", never the
        // shared default, so they stay private and never touch the global cache.
        ensureDefaultWorkspace: async () => {
          const { workspaceId } = await ensureUserCorpus(userId);
          return { id: workspaceId };
        },
        ensureYouTubeCorpus: async () => {
          const { corpusId } = await ensureUserCorpus(userId);
          return { id: corpusId };
        },
      },
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    logger.error('Upload failed', { error: String(error) });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

/**
 * GET /api/upload
 * Returns the maximum upload size for client-side validation.
 */
export async function GET() {
  return NextResponse.json({
    maxSizeBytes: MAX_FILE_SIZE,
    maxSizeHuman: '500MB',
    allowedTypes: ['audio/*', 'video/mp4', 'video/webm', 'video/ogg'],
    mimeTypes: ALLOWED_MIME_TYPES,
  });
}
