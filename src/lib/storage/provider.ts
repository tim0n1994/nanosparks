/**
 * Storage Provider Interface
 *
 * Abstract interface for object storage.
 * M0: LocalStorageProvider (filesystem-based, zero infrastructure)
 * M1: S3StorageProvider (@aws-sdk/client-s3 + MinIO/S3/R2)
 *
 * Design: Swap via environment variable STORAGE_PROVIDER=local|s3
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { StorageSaveResult } from '@/types/domain';

export interface StorageProvider {
  /** Save a file/buffer and return its storage key and URL */
  save(key: string, buffer: Buffer, mimeType: string): Promise<StorageSaveResult>;

  /** Retrieve a file by its storage key */
  get(key: string): Promise<Buffer>;

  /** Delete a file by its storage key */
  delete(key: string): Promise<void>;

  /** Get a publicly accessible URL for a key (may return null for private files) */
  getPublicUrl(key: string): string | null;

  /** Generate a unique storage key from content hash */
  generateKey(originalName: string, buffer: Buffer): string;
}

/**
 * Local filesystem storage provider.
 * Files are stored under UPLOAD_DIR (default: ./data/uploads).
 * Suitable for M0 development.
 */
export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(process.cwd(), 'data', 'uploads');
  }

  async save(key: string, buffer: Buffer, _mimeType: string): Promise<StorageSaveResult> {
    const filePath = join(this.baseDir, key);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(filePath, buffer);

    return {
      key,
      url: `/api/storage/${key}`,
      size: buffer.length,
    };
  }

  async get(key: string): Promise<Buffer> {
    const filePath = join(this.baseDir, key);
    return readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.baseDir, key);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  getPublicUrl(key: string): string | null {
    return `/api/storage/${key}`;
  }

  generateKey(originalName: string, buffer: Buffer): string {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const ext = originalName.split('.').pop() ?? 'bin';
    const timestamp = Date.now();
    return `${hash}-${timestamp}.${ext}`;
  }
}

/**
 * Create a storage provider based on environment.
 */
export function createStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER ?? 'local';

  switch (provider) {
    case 'local':
    default:
      return new LocalStorageProvider();
  }
}
