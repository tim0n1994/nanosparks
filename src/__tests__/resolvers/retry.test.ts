import { describe, it, expect, vi } from 'vitest';
import { withRetry, isTransientError } from '@/lib/resolvers/retry';

describe('isTransientError', () => {
  it('flags network errors as transient', () => {
    expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
    expect(isTransientError(new Error('fetch failed: ETIMEDOUT'))).toBe(true);
  });

  it('flags 429 and 5xx as transient', () => {
    expect(isTransientError(new Error('failed to fetch page: 429'))).toBe(true);
    expect(isTransientError(new Error('failed to fetch page: 503'))).toBe(true);
  });

  it('does NOT flag 404/403/400 as transient', () => {
    expect(isTransientError(new Error('failed to fetch page: 404'))).toBe(false);
    expect(isTransientError(new Error('forbidden 403'))).toBe(false);
  });

  it('does not flag unrelated errors', () => {
    expect(isTransientError(new Error('something else'))).toBe(false);
    expect(isTransientError('not an error')).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 0, maxDelayMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient errors then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 0, maxDelayMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('404 not found'));
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 0 })).rejects.toThrow('404');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries on persistent transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503'));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 0, maxDelayMs: 0 })).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('calls onRetry for each retry', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { retries: 3, baseDelayMs: 0, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][1]).toBe(1); // attempt number
  });

  it('respects a custom shouldRetry', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always retry me'));
    const shouldRetry = () => true;
    await expect(withRetry(fn, { retries: 1, baseDelayMs: 0, shouldRetry })).rejects.toThrow('always retry me');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
