import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LLM_TIMEOUT_MS, resolveLlmTimeoutMs } from '@/lib/llm/client';

describe('resolveLlmTimeoutMs', () => {
  const KEY = 'NSP_LLM_TIMEOUT_MS';
  const saved = process.env[KEY];

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('defaults to 90s when the env var is unset', () => {
    delete process.env[KEY];
    expect(resolveLlmTimeoutMs()).toBe(DEFAULT_LLM_TIMEOUT_MS);
    expect(DEFAULT_LLM_TIMEOUT_MS).toBe(90_000);
  });

  it('uses a positive override for slow local models', () => {
    process.env[KEY] = '900000';
    expect(resolveLlmTimeoutMs()).toBe(900_000);
  });

  it('ignores zero, negative and non-numeric overrides', () => {
    for (const bad of ['0', '-1', 'abc', '']) {
      process.env[KEY] = bad;
      expect(resolveLlmTimeoutMs()).toBe(DEFAULT_LLM_TIMEOUT_MS);
    }
  });
});
