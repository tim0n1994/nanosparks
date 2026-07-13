/**
 * AES-GCM Encryption for Secrets
 *
 * Per Track F.5: Setting table API keys stored as AES-256-GCM ciphertext.
 * Master key comes from ENCRYPTION_MASTER_KEY env var.
 *
 * Format: base64(iv:ciphertext:authTag)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const envKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!envKey) {
    // In development, derive a deterministic key from a fallback.
    // In production, ENCRYPTION_MASTER_KEY must be set.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_MASTER_KEY must be set in production');
    }
    // Dev fallback: 32 bytes from a fixed string (NOT secure, dev only)
    return Buffer.from('nanosparks-dev-key-32-bytes-long!!', 'utf8').subarray(0, 32);
  }
  // Use first 32 bytes of the hex/base64 key
  const key = Buffer.from(envKey, 'hex');
  if (key.length >= 32) return key.subarray(0, 32);
  // Pad if too short
  return Buffer.concat([key, Buffer.alloc(32 - key.length)]).subarray(0, 32);
}

/**
 * Encrypt a plaintext string.
 * Returns base64(iv:ciphertext:authTag).
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64(iv:ciphertext:authTag) string.
 */
export function decrypt(ciphertext: string): string {
  const key = getMasterKey();
  const combined = Buffer.from(ciphertext, 'base64');

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Check if a string appears to be encrypted (base64 with correct length).
 */
export function isEncrypted(value: string): boolean {
  try {
    const buf = Buffer.from(value, 'base64');
    return buf.length > IV_LENGTH + AUTH_TAG_LENGTH;
  } catch {
    return false;
  }
}
