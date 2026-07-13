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
import { ensureDefaultWorkspace, ensureYouTubeCorpus } from '@/lib/adapters/episode-to-conversation';
import { transcribeQueue } from '@/lib/queue/config';
import { logger } from '@/lib/logger';
import { processUpload, UploadError, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from '@/lib/upload/service';

export async function POST(request: NextRequest) {
  try {
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
        ensureDefaultWorkspace,
        ensureYouTubeCorpus,
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
