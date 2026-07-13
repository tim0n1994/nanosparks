import { describe, it, expect, beforeEach, vi } from 'vitest';
import { encrypt, decrypt, isEncrypted } from '@/lib/crypto';

describe('crypto', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    delete process.env.ENCRYPTION_MASTER_KEY;
  });

  it('encrypts and decrypts a string', () => {
    const plaintext = 'sk-test-api-key-12345';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const plaintext = 'same-secret';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);

    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(plaintext);
    expect(decrypt(enc2)).toBe(plaintext);
  });

  it('handles empty strings', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });

  it('handles unicode text', () => {
    const plaintext = '密钥-key-🔑';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('isEncrypted returns false for plaintext', () => {
    expect(isEncrypted('not-encrypted')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  it('uses ENCRYPTION_MASTER_KEY when set', () => {
    process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64); // 32 bytes hex
    const plaintext = 'test-with-master-key';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });
});
