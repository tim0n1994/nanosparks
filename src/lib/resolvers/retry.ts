/**
 * Retry with exponential backoff (PRD §A1/§11: 低频+重试+必要时国内代理出口).
 *
 * Overseas IPs get rate-limited/blocked probabilistically by 小宇宙/B站/YouTube.
 * The PRD calls for retry on transient failures. This is a generic, testable
 * retry helper used by the xiaoyuzhou client and the resolver chain.
 *
 * Backoff is exponential with jitter, capped. Only retries on transient error
 * signals (network errors, 429, 5xx); non-transient errors (404, 403, 400) are
 * surfaced immediately so we don't waste budget retrying permanent failures.
 */

/** A transient error: worth retrying. */
export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Network / connection errors.
    if (/(econnreset|econnrefused|etimedout|enotfound|fetch failed|network|socket hang up)/.test(msg)) return true;
    // HTTP transient status codes embedded in thrown errors.
    if (/\b429\b/.test(msg)) return true;
    if (/\b5\d\d\b/.test(msg)) return true;
    // "failed to fetch page: 503" etc.
    if (/failed to fetch.*\b(429|5\d\d)\b/.test(msg)) return true;
  }
  return false;
}

export interface RetryOptions {
  retries?: number; // default 3
  baseDelayMs?: number; // default 1000
  maxDelayMs?: number; // default 8000
  shouldRetry?: (err: unknown) => boolean; // default isTransientError
  onRetry?: (err: unknown, attempt: number) => void;
}

/**
 * Run an async function with retry + exponential backoff + jitter.
 * Non-transient errors (per shouldRetry) are thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 8000;
  const shouldRetry = opts.shouldRetry ?? isTransientError;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) throw err;
      const backoff = Math.min(maxDelay, baseDelay * 2 ** attempt);
      const jitter = Math.floor(Math.random() * (backoff / 2));
      const delay = backoff - jitter;
      opts.onRetry?.(err, attempt + 1);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
