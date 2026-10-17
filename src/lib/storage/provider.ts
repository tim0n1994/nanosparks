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
import { getUploadDir } from '@/lib/media/runtime-paths';

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
    this.baseDir = baseDir ?? getUploadDir();
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
 * S3/MinIO Storage Provider
 *
 * Uses @aws-sdk/client-s3 for S3-compatible object storage (MinIO, R2, AWS S3).
 * Configured via environment:
 *   STORAGE_PROVIDER=s3
 *   S3_ENDPOINT=http://minio:9000
 *   S3_BUCKET=nanosparks
 *   S3_ACCESS_KEY=...
 *   S3_SECRET_KEY=...
 *   S3_REGION=us-east-1
 */
export class S3StorageProvider implements StorageProvider {
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'nanosparks';
  }

  private getClient() {
    // Lazy import to avoid loading AWS SDK when not using S3
    const { S3Client } = require('@aws-sdk/client-s3');
    return new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async save(key: string, buffer: Buffer, mimeType: string): Promise<StorageSaveResult> {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = this.getClient();
    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }));
    return { key, url: `/api/storage/${key}`, size: buffer.length };
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const client = this.getClient();
    const response = await client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const client = this.getClient();
    await client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  getPublicUrl(key: string): string | null {
    const endpoint = process.env.S3_PUBLIC_URL ?? process.env.S3_ENDPOINT;
    return endpoint ? `${endpoint.replace(/\/+$/, '')}/${this.bucket}/${key}` : null;
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
    case 's3':
      return new S3StorageProvider();
    case 'local':
    default:
      return new LocalStorageProvider();
  }
}
