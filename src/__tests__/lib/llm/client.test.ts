import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeClient, OpenAIClient, validateJsonResponse } from '@/lib/llm/client';
import { z } from 'zod';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('ClaudeClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns cached response without calling fetch', async () => {
    const client = new ClaudeClient('test-key');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    } as Response);

    const first = await client.complete([{ role: 'user', content: 'hi' }]);
    expect(first.content).toBe('Hello');

    const second = await client.complete([{ role: 'user', content: 'hi' }]);
    expect(second.content).toBe('Hello');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then throws', async () => {
    const client = new ClaudeClient('test-key');

    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(
      client.completeWithRetry([{ role: 'user', content: 'hi' }], 4096, 2)
    ).rejects.toThrow('Network error');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws on non-ok response', async () => {
    const client = new ClaudeClient('test-key');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    await expect(
      client.complete([{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('API error: 401 Unauthorized');
  });
});

describe('OpenAIClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls OpenAI endpoint with correct headers', async () => {
    const client = new OpenAIClient('sk-test');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
    } as Response);

    const result = await client.complete([{ role: 'user', content: 'hello' }]);
    expect(result.content).toBe('Response');

    const call = mockFetch.mock.calls[0];
    expect(call[1].headers.Authorization).toBe('Bearer sk-test');
  });
});

describe('validateJsonResponse', () => {
  const schema = z.object({ name: z.string() });

  it('parses JSON inside markdown code block', () => {
    const result = validateJsonResponse('```json\n{"name": "test"}\n```', schema);
    expect(result).toEqual({ name: 'test' });
  });

  it('parses raw JSON', () => {
    const result = validateJsonResponse('{"name": "test"}', schema);
    expect(result).toEqual({ name: 'test' });
  });

  it('throws on invalid JSON', () => {
    expect(() => validateJsonResponse('not json', schema)).toThrow();
  });

  it('throws on schema mismatch', () => {
    expect(() => validateJsonResponse('{"name": 123}', schema)).toThrow();
  });
});
