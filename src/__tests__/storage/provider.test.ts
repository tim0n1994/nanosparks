/**
 * Tests for LocalStorageProvider
 *
 * Tests file system operations: save, get, delete, generateKey, getPublicUrl.
 * Uses a temporary directory to avoid polluting real uploads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAudioOutputDir } from '@/lib/media/runtime-paths';
import { mkdir, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { LocalStorageProvider } from '@/lib/storage/provider';

const TEST_DIR = join(process.cwd(), '.test-uploads');

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    provider = new LocalStorageProvider(TEST_DIR);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('uses the configured upload directory for a real save/read round trip', async () => {
    const isolated = join(TEST_DIR, 'isolated');
    vi.stubEnv('UPLOAD_DIR', isolated);
    const configured = new LocalStorageProvider();
    await configured.save('fixture.txt', Buffer.from('isolated fixture'), 'text/plain');
    expect(await readFile(join(isolated, 'fixture.txt'), 'utf8')).toBe('isolated fixture');
    expect((await configured.get('fixture.txt')).toString()).toBe('isolated fixture');
  });

  it('retains explicit constructor precedence over environment configuration', async () => {
    vi.stubEnv('UPLOAD_DIR', 'invalid-relative-directory');
    await provider.save('explicit.txt', Buffer.from('explicit'), 'text/plain');
    expect(await readFile(join(TEST_DIR, 'explicit.txt'), 'utf8')).toBe('explicit');
    expect(() => new LocalStorageProvider(TEST_DIR)).not.toThrow();
  });

  it.each(['', 'relative/uploads'])('rejects invalid upload directory %j', value => {
    vi.stubEnv('UPLOAD_DIR', value);
    expect(() => new LocalStorageProvider()).toThrow('UPLOAD_DIR must be an absolute directory path');
  });

  it('keeps the legacy audio directory unless explicitly configured', () => {
    vi.stubEnv('NSP_AUDIO_DIR', undefined);
    expect(getAudioOutputDir()).toBe('/tmp/nanosparks-audio');
    vi.stubEnv('NSP_AUDIO_DIR', join(TEST_DIR, 'audio'));
    expect(getAudioOutputDir()).toBe(join(TEST_DIR, 'audio'));
    vi.stubEnv('NSP_AUDIO_DIR', 'relative/audio');
    expect(() => getAudioOutputDir()).toThrow('NSP_AUDIO_DIR must be an absolute directory path');
  });

  describe('save', () => {
    it('writes a file to disk and returns key, url, and size', async () => {
      const buffer = Buffer.from('test audio content');
      const result = await provider.save('test/audio.mp3', buffer, 'audio/mpeg');

      expect(result.key).toBe('test/audio.mp3');
      expect(result.url).toBe('/api/storage/test/audio.mp3');
      expect(result.size).toBe(buffer.length);

      // Verify file exists on disk
      const filePath = join(TEST_DIR, 'test/audio.mp3');
      expect(existsSync(filePath)).toBe(true);

      const content = await readFile(filePath);
      expect(content.toString()).toBe('test audio content');
    });

    it('creates nested directories when saving', async () => {
      const buffer = Buffer.from('nested file');
      await provider.save('deeply/nested/path/file.wav', buffer, 'audio/wav');

      const filePath = join(TEST_DIR, 'deeply/nested/path/file.wav');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('get', () => {
    it('reads a file from disk', async () => {
      const buffer = Buffer.from('file content for read');
      await provider.save('read-test.bin', buffer, 'application/octet-stream');

      const result = await provider.get('read-test.bin');
      expect(result.toString()).toBe('file content for read');
      expect(result).toBeInstanceOf(Buffer);
    });

    it('throws when file does not exist', async () => {
      await expect(provider.get('nonexistent.bin')).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('removes a file from disk', async () => {
      const buffer = Buffer.from('to be deleted');
      await provider.save('delete-me.bin', buffer, 'application/octet-stream');

      const filePath = join(TEST_DIR, 'delete-me.bin');
      expect(existsSync(filePath)).toBe(true);

      await provider.delete('delete-me.bin');
      expect(existsSync(filePath)).toBe(false);
    });

    it('does not throw when deleting a nonexistent file', async () => {
      // Should not throw
      await expect(provider.delete('does-not-exist.bin')).resolves.toBeUndefined();
    });
  });

  describe('generateKey', () => {
    it('produces a key with hash, timestamp, and original extension', () => {
      const buffer = Buffer.from('content for key generation');
      const key = provider.generateKey('recording.mp3', buffer);

      // Format: {16-char-hex}-{timestamp}.mp3
      expect(key).toMatch(/^[0-9a-f]{16}-\d+\.mp3$/);
    });

  it('uses the full filename when no extension is found (pop returns the whole name)', () => {
    const buffer = Buffer.from('no extension');
    const key = provider.generateKey('noext', buffer);

    // 'noext'.split('.').pop() returns 'noext' itself
    expect(key).toMatch(/^[0-9a-f]{16}-\d+\.noext$/);
  });

  it('produces a trailing dot when filename ends with a dot (?? does not catch empty string)', () => {
    const buffer = Buffer.from('dot end');
    const key = provider.generateKey('ends_with_dot.', buffer);

    // 'ends_with_dot.'.split('.').pop() returns '' (empty string).
    // '' is NOT null/undefined, so ?? 'bin' doesn't trigger.
    expect(key).toMatch(/^[0-9a-f]{16}-\d+\.$/);
  });

    it('produces different keys for different content', () => {
      const key1 = provider.generateKey('a.mp3', Buffer.from('content A'));
      const key2 = provider.generateKey('a.mp3', Buffer.from('content B'));

      expect(key1).not.toBe(key2);
    });
  });

  describe('getPublicUrl', () => {
    it('returns the storage URL for the key', () => {
      const url = provider.getPublicUrl('some-key.mp3');
      expect(url).toBe('/api/storage/some-key.mp3');
    });
  });

  describe('integration: save, get, delete cycle', () => {
    it('completes a full lifecycle', async () => {
      const buffer = Buffer.from('full lifecycle test');
      const key = provider.generateKey('lifecycle.wav', buffer);

      // Save
      const saveResult = await provider.save(key, buffer, 'audio/wav');
      expect(saveResult.key).toBe(key);
      expect(saveResult.size).toBe(buffer.length);

      // Read back
      const readBuffer = await provider.get(key);
      expect(readBuffer.toString()).toBe('full lifecycle test');

      // Delete
      await provider.delete(key);

      // Verify gone
      const filePath = join(TEST_DIR, key);
      expect(existsSync(filePath)).toBe(false);
    });
  });
});
