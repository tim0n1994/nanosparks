# NanoSparks Testing Review & Action Plan

## Current State Snapshot (2026-04-24 Updated)

| Metric | Value |
|--------|-------|
| Source files (.ts/.tsx) | 66 |
| Unit test files | **7** |
| E2E spec files | 7 |
| Framework | Vitest + @testing-library/react + jsdom |
| E2E Framework | Playwright |
| Coverage thresholds | 80% (lines, functions, branches, statements) |
| **TypeScript compile** | **0 errors** |
| **Unit tests passing** | **29/29** |

**Current test files:**
- `src/__tests__/transcription/chunker.test.ts`
- `src/__tests__/ui/StatusBadge.test.tsx`
- `src/__tests__/visualization/QuoteCard.test.tsx`
- `src/__tests__/visualization/ReferencePanel.test.tsx` (NEW - XSS filtering)
- `src/__tests__/youtube/parser.test.ts`
- `src/__tests__/lib/llm/client.test.ts` (NEW - cache, retry, JSON validation)
- `src/__tests__/lib/rate-limit.test.ts` (NEW - rate limiting logic)

---

## 0. Completed Fixes (2026-04-24)

### 0.1 CRITICAL Bug & Security Fixes (5 items)

| Issue | File | Status |
|-------|------|--------|
| `TRANSCRIBED` status missing from enum | `prisma/schema.prisma` | Fixed |
| Transcription sets `COMPLETED` instead of `TRANSCRIBED` | `src/lib/queue/jobs/transcribe.ts` | Fixed |
| `channelId: 'pending'` FK violation + no auth | `src/app/api/ingest/route.ts` | Fixed |
| Shell injection via `exec` string interpolation | `src/lib/transcription/whisper.ts` | Fixed (execFile + whitelist) |
| Shell injection via `exec` string interpolation | `src/lib/youtube/downloader.ts` | Fixed (execFile + ID validation) |
| XSS via unvalidated Reference URL rendering | `src/components/visualization/ReferencePanel.tsx` | Fixed (isSafeUrl filter) |
| `/api/ingest` bypasses Clerk auth | `src/middleware.ts` | Fixed (removed from public routes) |
| Docker worker uses `npx ts-node` (not in deps) | `docker-compose.yml` | Fixed (tsx) |
| Missing `ANTHROPIC_API_KEY` in docker-compose | `docker-compose.yml` | Fixed |

### 0.2 Architecture Refactors (3 items)

| Refactor | File | Rationale |
|----------|------|-----------|
| Worker Factory pattern | `src/lib/queue/worker-factory.ts` NEW | Eliminated 3 nearly identical worker files |
| LLM Client base class | `src/lib/llm/client.ts` | Extracted `BaseLLMClient`, eliminated ~130 lines duplicate cache/retry/hash logic |
| Rate limit export | `src/lib/rate-limit.ts` | Added `rateLimit()` async wrapper for route integration |

### 0.3 Test Additions (3 files, 14 tests)

| Test File | Coverage Focus |
|-----------|---------------|
| `lib/llm/client.test.ts` | ClaudeClient cache, retry, error handling; OpenAIClient headers; validateJsonResponse |
| `lib/rate-limit.test.ts` | First request, limit exceeded, window reset |
| `visualization/ReferencePanel.test.tsx` | URL filtering (XSS prevention), relevance sorting, empty state |

---

## 1. Existing Test Quality Review

### 1.1 Grade: C+ (Functional but Thin)

| File | Coverage | AAA Pattern | Naming | Edge Cases | Mocks |
|------|----------|-------------|--------|------------|-------|
| `parser.test.ts` | Partial | No | Good | Missing (playlist, empty) | None needed |
| `chunker.test.ts` | Weak | No | Weak | Missing (single segment, huge chunkSize) | None needed |
| `StatusBadge.test.tsx` | Weak | No | Weak | Missing (empty string, undefined) | None needed |
| `QuoteCard.test.tsx` | Weak | No | Weak | Missing (null speaker, long text) | None needed |

**Issues found:**

1. **No AAA structure** in any test. Tests mix Arrange/Act/Assert with no visual separation.
2. **Weak assertions**: `chunker.test.ts` asserts `length > 0` but never verifies actual chunk contents or that overlap works correctly.
3. **Missing edge cases**: No tests for empty strings, null/undefined inputs, single-item arrays, extremely large inputs, or invalid types.
4. **No mock infrastructure**: External dependencies (Prisma, fetch, bullmq, child_process) are not mocked in any test.
5. **No error path coverage**: No tests verify what happens when functions throw or receive malformed data.

### 1.2 Immediate Fixes for Existing Tests

- [ ] Refactor all 4 existing test files to AAA structure
- [ ] Add edge case tests to each existing file
- [ ] Add assertion on actual return values, not just existence

---

## 2. Missing Tests: Priority Matrix

### P0: Core Business Logic (Must Have for 80% Coverage)

| Module | Test File | Priority | Why |
|--------|-----------|----------|-----|
| `lib/queue/jobs/ingest.ts` | `__tests__/queue/jobs/ingest.test.ts` | P0 | Orchestrates entire pipeline entry point |
| `lib/queue/jobs/transcribe.ts` | `__tests__/queue/jobs/transcribe.test.ts` | P0 | Audio download + transcription orchestration |
| `lib/queue/jobs/analyze.ts` | `__tests__/queue/jobs/analyze.test.ts` | P0 | LLM orchestration, analysis creation, quality scoring |
| `lib/llm/client.ts` | `__tests__/llm/client.test.ts` | P0 | External API client with caching, retry, JSON validation |
| `lib/youtube/client.ts` | `__tests__/youtube/client.test.ts` | P0 | YouTube API client, all 3 endpoints |
| `lib/transcription/whisper.ts` | `__tests__/transcription/whisper.test.ts` | P0 | Transcription logic with fallback |
| `app/api/ingest/route.ts` | `__tests__/api/ingest.test.ts` | P0 | Main API endpoint, validation, channel/video branches |

### P1: Supporting Infrastructure

| Module | Test File | Priority | Why |
|--------|-----------|----------|-----|
| `lib/youtube/downloader.ts` | `__tests__/youtube/downloader.test.ts` | P1 | External process spawning, fs operations |
| `lib/rate-limit.ts` | `__tests__/rate-limit.test.ts` | P1 | Security-critical, time-dependent logic |
| `lib/env.ts` | `__tests__/env.test.ts` | P1 | Startup validation, schema enforcement |
| `lib/logger.ts` | `__tests__/logger.test.ts` | P1 | Simple but should verify formatting |
| `lib/queue/config.ts` | `__tests__/queue/config.test.ts` | P1 | Bullmq queue creation, job addition |
| `app/api/health/route.ts` | `__tests__/api/health.test.ts` | P1 | Health check, dependency verification |
| `app/api/episodes/[id]/full/route.ts` | `__tests__/api/episodes/full.test.ts` | P1 | Episode retrieval with relations |
| `app/api/episodes/[id]/status/route.ts` | `__tests__/api/episodes/status.test.ts` | P1 | Status polling endpoint |
| `app/api/playlists/route.ts` | `__tests__/api/playlists.test.ts` | P1 | CRUD operations |
| `app/api/playlists/[id]/route.ts` | `__tests__/api/playlists/id.test.ts` | P1 | Get/delete with 404 handling |

### P2: UI Components

| Module | Test File | Priority | Why |
|--------|-----------|----------|-----|
| `components/visualization/TopicCluster.tsx` | `__tests__/visualization/TopicCluster.test.tsx` | P2 | Rendering, click handlers, empty topics |
| `components/visualization/ArgumentThread.tsx` | `__tests__/visualization/ArgumentThread.test.tsx` | P2 | Recursive rendering, rootId filter, empty state |
| `components/visualization/SpeakerTimeline.tsx` | `__tests__/visualization/SpeakerTimeline.test.tsx` | P2 | D3 integration, timeline rendering |
| `components/visualization/IdeaMap.tsx` | `__tests__/visualization/IdeaMap.test.tsx` | P2 | Cytoscape integration |
| `components/visualization/ReferencePanel.tsx` | `__tests__/visualization/ReferencePanel.test.tsx` | P2 | Link rendering, empty state |
| `lib/utils.ts` (cn function) | `__tests__/utils.test.ts` | P2 | Simple utility but core to all styling |

### P3: Workers and Glue Code

| Module | Test File | Priority | Why |
|--------|-----------|----------|-----|
| `lib/queue/workers/ingest-worker.ts` | `__tests__/queue/workers/ingest-worker.test.ts` | P3 | Thin wrapper around processIngestJob |
| `lib/queue/workers/transcribe-worker.ts` | `__tests__/queue/workers/transcribe-worker.test.ts` | P3 | Thin wrapper |
| `lib/queue/workers/analyze-worker.ts` | `__tests__/queue/workers/analyze-worker.test.ts` | P3 | Thin wrapper |
| `lib/queue/worker.ts` (index) | `__tests__/queue/worker.test.ts` | P3 | Worker bootstrap |

---

## 3. How to Test Async Queue Workers

### Strategy: Test `processXxxJob` functions, NOT Bullmq Worker instances

The worker files (`ingest-worker.ts`, `transcribe-worker.ts`, `analyze-worker.ts`) are thin wrappers around `processXxxJob`. Test the job processors directly. Mock all external dependencies.

### Mocking Dependencies

```typescript
// __tests__/queue/jobs/ingest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processIngestJob } from '@/lib/queue/jobs/ingest';

// Mock all external modules
vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('@/lib/queue/config', () => ({
  addTranscribeJob: vi.fn().mockResolvedValue('job-123'),
}));

vi.mock('@/lib/youtube/client', () => ({
  YouTubeClient: vi.fn().mockImplementation(() => ({
    getVideo: vi.fn().mockResolvedValue({
      title: 'Test Video',
      description: 'Desc',
      thumbnailUrl: 'http://thumb.jpg',
      duration: 'PT5M30S',
    }),
  })),
}));

vi.mock('@/lib/youtube/parser', () => ({
  parseYouTubeUrl: vi.fn().mockReturnValue({ type: 'video', id: 'abc123' }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));
```

### Test Scenarios for `processIngestJob`

```typescript
describe('processIngestJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates episode status to DOWNLOADING then TRANSCRIBING on success', async () => {
    // Arrange
    const data = { episodeId: 'ep-1', youtubeUrl: 'https://youtube.com/watch?v=abc123' };

    // Act
    await processIngestJob(data);

    // Assert
    expect(prisma.episode.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'ep-1' },
      data: { status: 'DOWNLOADING' },
    });
    expect(prisma.episode.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'TRANSCRIBING' }) })
    );
  });

  it('parses duration correctly from ISO 8601 format', async () => {
    // Arrange
    const data = { episodeId: 'ep-1', youtubeUrl: 'https://youtube.com/watch?v=abc123' };

    // Act
    await processIngestJob(data);

    // Assert
    expect(prisma.episode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duration: 330 }),
      })
    );
  });

  it('enqueues transcribe job after successful metadata fetch', async () => {
    // Arrange
    const data = { episodeId: 'ep-1', youtubeUrl: 'https://youtube.com/watch?v=abc123' };

    // Act
    await processIngestJob(data);

    // Assert
    expect(addTranscribeJob).toHaveBeenCalledWith({ episodeId: 'ep-1', youtubeUrl: data.youtubeUrl });
  });

  it('sets FAILED status and re-throws on error', async () => {
    // Arrange
    const data = { episodeId: 'ep-1', youtubeUrl: 'https://youtube.com/watch?v=abc123' };
    vi.mocked(YouTubeClient).mockImplementation(() => {
      throw new Error('API key invalid');
    });

    // Act + Assert
    await expect(processIngestJob(data)).rejects.toThrow('API key invalid');
    expect(prisma.episode.update).toHaveBeenLastCalledWith({
      where: { id: 'ep-1' },
      data: { status: 'FAILED' },
    });
  });

  it('throws for unsupported URL types (channel, playlist)', async () => {
    // Arrange
    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'channel', id: '@test' });
    const data = { episodeId: 'ep-1', youtubeUrl: 'https://youtube.com/@test' };

    // Act + Assert
    await expect(processIngestJob(data)).rejects.toThrow('Unsupported URL type');
  });

  it('handles empty YouTube API key gracefully', async () => {
    // Arrange
    const originalEnv = process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_API_KEY = '';
    const data = { episodeId: 'ep-1', youtubeUrl: 'https://youtube.com/watch?v=abc123' };

    // Act + Assert
    await expect(processIngestJob(data)).rejects.toThrow();

    // Cleanup
    process.env.YOUTUBE_API_KEY = originalEnv;
  });
});
```

### Test Scenarios for `processTranscribeJob`

```typescript
describe('processTranscribeJob', () => {
  it('downloads audio and transcribes successfully', async () => {
    // downloadAudio and transcribeAudio mocked to return segments
    // Assert: episode updated with transcript and status COMPLETED
    // Assert: analyze job enqueued
  });

  it('uses mock fallback when downloadAudio fails', async () => {
    // downloadAudio throws error
    // Assert: transcribeAudio not called, fallback segments used
    // Assert: episode updated with fallback transcript
  });

  it('uses mock fallback when videoId cannot be extracted', async () => {
    // youtubeUrl without valid videoId
    // Assert: fallback segments used
  });

  it('sets FAILED status on unexpected error', async () => {
    // prisma.update throws in outer try
    // Assert: status FAILED, error thrown
  });

  it('extracts videoId from youtu.be short URL', async () => {
    // youtubeUrl = 'https://youtu.be/abc123'
    // Assert: downloadAudio called with 'abc123'
  });
});
```

### Test Scenarios for `processAnalyzeJob`

```typescript
describe('processAnalyzeJob', () => {
  it('sets ANALYZING status at start', async () => {
    // Assert prisma.episode.update called with ANALYZING
  });

  it('fetches episode and validates transcript exists', async () => {
    // prisma.episode.findUnique returns episode with transcript
    // Assert: finds episode
  });

  it('throws when episode has no transcript', async () => {
    // prisma.episode.findUnique returns episode without transcript
    // Assert: throws 'Episode or transcript not found'
    // Assert: status set to FAILED
  });

  it('calls LLM client with all 4 extraction prompts in parallel', async () => {
    // Assert: ClaudeClient.completeWithRetry called 4 times
    // Assert: each call contains correct prompt content
  });

  it('handles partial LLM failures gracefully (does not fail entire job)', async () => {
    // 2 of 4 LLM calls throw
    // Assert: job continues, creates analysis with empty arrays for failed extractions
  });

  it('validates LLM responses with Zod schemas', async () => {
    // completeWithRetry returns valid JSON string
    // Assert: validateJsonResponse called with correct schema
  });

  it('handles invalid JSON from LLM gracefully', async () => {
    // completeWithRetry returns malformed JSON
    // Assert: logger.warn called, empty array used for that field
  });

  it('calls reference generation prompt with arguments context', async () => {
    // Assert: REFERENCE_GENERATION_PROMPT contains replaced {{transcript}} and {{arguments}}
  });

  it('calculates quality score correctly', async () => {
    // Mock: 5 arguments, 3 quotes, 4 references (3 with http), 6 topics
    // qualityScore = min(1, (5/10)*0.3 + (3/5)*0.2 + (3/5)*0.3 + (6/5)*0.2)
    // = min(1, 0.15 + 0.12 + 0.18 + 0.24) = min(1, 0.69) = 0.69
    // Assert: analysis created with qualityScore ~0.69
  });

  it('creates analysis with correct nested references', async () => {
    // Assert: prisma.analysis.create called with references.create array
  });

  it('sets COMPLETED status after analysis creation', async () => {
    // Assert: final episode.update with status COMPLETED
  });

  it('sets FAILED status on any error', async () => {
    // Mock completeWithRetry to throw on first call
    // Assert: status FAILED, error re-thrown
  });
});
```

---

## 4. How to Mock LLM API Calls

### Strategy: Mock `global.fetch` + Test Cache Behavior

```typescript
// __tests__/llm/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeClient, OpenAIClient, validateJsonResponse } from '@/lib/llm/client';

describe('ClaudeClient', () => {
  let client: ClaudeClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new ClaudeClient('test-key');
    global.fetch = mockFetch;
    vi.clearAllMocks();
  });

  it('returns cached response on identical request', async () => {
    // Arrange
    const messages = [{ role: 'user' as const, content: 'hello' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'cached result' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    // Act - first call
    const result1 = await client.complete(messages);

    // Act - second call (should not hit fetch)
    const result2 = await client.complete(messages);

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result1.content).toBe('cached result');
    expect(result2.content).toBe('cached result');
  });

  it('bypasses cache when skipCache is true', async () => {
    // Arrange
    const messages = [{ role: 'user' as const, content: 'hello' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'result' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    // Act
    await client.complete(messages);
    await client.complete(messages, 4096, true); // skipCache

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('expires cache after TTL', async () => {
    // Arrange - use vi.useFakeTimers()
    vi.useFakeTimers();
    const messages = [{ role: 'user' as const, content: 'hello' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'result' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    // Act - first call
    await client.complete(messages);

    // Advance time by 2 hours
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);

    // Act - second call should hit fetch again
    await client.complete(messages);

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws on API error with status code', async () => {
    // Arrange
    const messages = [{ role: 'user' as const, content: 'hello' }];
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: () => Promise.resolve('Rate limited'),
    });

    // Act + Assert
    await expect(client.complete(messages)).rejects.toThrow('Claude API error: 429 Rate limited');
  });

  it('retries with exponential backoff on failure', async () => {
    // Arrange
    const messages = [{ role: 'user' as const, content: 'hello' }];
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'success' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Act
    const promise = client.completeWithRetry(messages);
    await vi.advanceTimersByTimeAsync(7000); // 1s + 2s backoff
    const result = await promise;

    // Assert
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.content).toBe('success');
    vi.useRealTimers();
  });

  it('throws last error after all retries exhausted', async () => {
    // Arrange
    const messages = [{ role: 'user' as const, content: 'hello' }];
    mockFetch.mockRejectedValue(new Error('Persistent failure'));

    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Act + Assert
    const promise = client.completeWithRetry(messages, 4096, 3);
    await vi.advanceTimersByTimeAsync(15000);
    await expect(promise).rejects.toThrow('Persistent failure');

    vi.useRealTimers();
  });

  it('sends correct headers and body format', async () => {
    // Arrange
    const messages = [{ role: 'user' as const, content: 'hello world' }];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    });

    // Act
    await client.complete(messages, 2048);

    // Assert
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        },
        body: expect.stringContaining('"max_tokens":2048'),
      })
    );
  });
});

describe('OpenAIClient', () => {
  // Same pattern as ClaudeClient but for OpenAI endpoint and response shape
  // Tests: cache, retry, error handling, Authorization header with Bearer token
});

describe('validateJsonResponse', () => {
  it('extracts JSON from markdown code blocks', () => {
    const content = '```json\n{"key": "value"}\n```';
    const schema = z.object({ key: z.string() });
    const result = validateJsonResponse(content, schema);
    expect(result).toEqual({ key: 'value' });
  });

  it('parses bare JSON when no code block present', () => {
    const content = '{"key": "value"}';
    const schema = z.object({ key: z.string() });
    const result = validateJsonResponse(content, schema);
    expect(result).toEqual({ key: 'value' });
  });

  it('throws descriptive error on invalid JSON', () => {
    const content = 'not json';
    const schema = z.object({ key: z.string() });
    expect(() => validateJsonResponse(content, schema)).toThrow('Failed to validate LLM response');
  });

  it('throws descriptive error on schema mismatch', () => {
    const content = '{"key": 123}';
    const schema = z.object({ key: z.string() });
    expect(() => validateJsonResponse(content, schema)).toThrow();
  });
});
```

---

## 5. How to Test Prisma Database Operations

### Strategy: Mock PrismaClient (Do NOT use real DB in unit tests)

```typescript
// __tests__/setup.ts (enhanced)
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Global Prisma mock
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    channel: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    episode: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    analysis: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    playlist: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    referenceLink: {
      createMany: vi.fn(),
    },
  },
}));
```

### Mock Helper for Episode with Relations

```typescript
// __tests__/helpers/prisma-factories.ts
import { vi } from 'vitest';

export function mockEpisode(overrides = {}) {
  return {
    id: 'ep-test-1',
    youtubeId: 'abc123',
    title: 'Test Episode',
    description: 'Description',
    duration: 300,
    thumbnailUrl: 'http://thumb.jpg',
    channelId: 'ch-1',
    status: 'PENDING',
    transcript: null,
    analysis: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

export function mockChannel(overrides = {}) {
  return {
    id: 'ch-1',
    youtubeId: '@test',
    title: 'Test Channel',
    description: 'Channel description',
    thumbnailUrl: 'http://ch-thumb.jpg',
    episodes: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

export function mockAnalysis(overrides = {}) {
  return {
    id: 'an-1',
    episodeId: 'ep-test-1',
    arguments: [],
    speakers: [],
    topics: [],
    quotes: [],
    qualityScore: 0.5,
    references: [],
    generatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}
```

### API Route Testing Pattern (Using NextRequest mock)

```typescript
// __tests__/api/ingest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/ingest/route';
import { prisma } from '@/lib/prisma';

// Mock dependencies
vi.mock('@/lib/prisma', () => ({ prisma: { episode: { create: vi.fn(), upsert: vi.fn() }, channel: { upsert: vi.fn() } } }));
vi.mock('@/lib/queue/config', () => ({ addIngestJob: vi.fn().mockResolvedValue('job-1') }));
vi.mock('@/lib/youtube/client');
vi.mock('@/lib/youtube/parser');

function createRequest(body: object): Request {
  return new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ingest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 for invalid URL format', async () => {
    const request = createRequest({ url: 'not-a-url', mode: 'robot' });
    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid mode', async () => {
    const request = createRequest({ url: 'https://youtube.com/watch?v=abc123', mode: 'invalid' });
    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });

  it('creates episode and enqueues job for video URL', async () => {
    // Arrange
    vi.mocked(YouTubeClient).mockImplementation(() => ({
      getVideo: vi.fn().mockResolvedValue({ title: 'Test', description: 'Desc', duration: 'PT5M', thumbnailUrl: '' }),
    }));
    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'video', id: 'abc123' });
    vi.mocked(prisma.episode.create).mockResolvedValue({ id: 'ep-1' });

    // Act
    const request = createRequest({ url: 'https://youtube.com/watch?v=abc123', mode: 'robot' });
    const response = await POST(request as any);
    const body = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.episodeIds).toContain('ep-1');
    expect(prisma.episode.create).toHaveBeenCalled();
  });

  it('upserts channel and creates episodes for channel URL', async () => {
    // Arrange
    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'channel', id: '@test' });
    vi.mocked(prisma.channel.upsert).mockResolvedValue({ id: 'ch-1' });
    // ... set up getChannelVideos mock to return 3 videos

    // Act
    const request = createRequest({ url: 'https://youtube.com/@test', mode: 'robot' });
    const response = await POST(request as any);
    const body = await response.json();

    // Assert
    expect(body.channelId).toBe('ch-1');
    expect(addIngestJob).toHaveBeenCalledTimes(3);
  });

  it('returns 400 for playlist URLs with helpful message', async () => {
    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'playlist', id: 'PLxxx' });
    const request = createRequest({ url: 'https://youtube.com/playlist?list=PLxxx', mode: 'robot' });
    const response = await POST(request as any);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Playlist support coming soon');
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(YouTubeClient).mockImplementation(() => { throw new Error('boom'); });
    const request = createRequest({ url: 'https://youtube.com/watch?v=abc123', mode: 'robot' });
    const response = await POST(request as any);
    expect(response.status).toBe(500);
  });
});
```

---

## 6. E2E Test Strategy for Critical User Flows

### Current E2E State

| File | Tests | Quality | Issue |
|------|-------|---------|-------|
| `health.spec.ts` | 1 | Good | Tests endpoint + version |
| `homepage.spec.ts` | 1 | Good | Basic title + nav check |
| `ingest.spec.ts` | 2 | Weak | "submit without URL" test doesn't actually assert validation error |
| `dashboard.spec.ts` | 1 | Unknown | Not reviewed |
| `share.spec.ts` | 1 | Unknown | Not reviewed |
| `submit.spec.ts` | 1 | Unknown | Not reviewed |
| `visualization.spec.ts` | 1 | Unknown | Not reviewed |

### Critical Flows to E2E Test

```typescript
// e2e/critical-flows.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Critical User Flows', () => {
  test('user submits a video URL and sees processing pipeline', async ({ page }) => {
    // 1. Navigate to submit page
    await page.goto('/submit');

    // 2. Enter a known short video URL (use a test fixture)
    await page.fill('input[name="url"]', 'https://youtube.com/watch?v=BaW_jenozKc'); // test video
    await page.selectOption('select[name="mode"]', 'robot');
    await page.click('button:has-text("Analyze")');

    // 3. Expect redirect to episode page or dashboard
    await expect(page).toHaveURL(/dashboard|episode/);

    // 4. Expect to see status badge
    await expect(page.locator('text=Pending')).toBeVisible();
  });

  test('health endpoint reports all services up', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.checks.db).toBe(true);
    expect(body.checks.redis).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('episode status API returns correct structure', async ({ request }) => {
    // This requires a seeded episode in test DB
    const response = await request.get('/api/episodes/test-episode-id/status');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('hasTranscript');
    expect(typeof body.hasTranscript).toBe('boolean');
  });

  test('playlist CRUD operations', async ({ request }) => {
    // Create
    const createRes = await request.post('/api/playlists', {
      data: { name: 'Test Playlist', description: 'Test desc' },
    });
    expect(createRes.ok()).toBeTruthy();
    const { playlist } = await createRes.json();

    // Read
    const getRes = await request.get(`/api/playlists/${playlist.id}`);
    expect(getRes.ok()).toBeTruthy();
    const got = await getRes.json();
    expect(got.name).toBe('Test Playlist');

    // Delete
    const delRes = await request.delete(`/api/playlists/${playlist.id}`);
    expect(delRes.ok()).toBeTruthy();

    // Verify deleted
    const getAgain = await request.get(`/api/playlists/${playlist.id}`);
    expect(getAgain.status()).toBe(404);
  });

  test('navigation between dashboard and episode detail', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Analyze a Channel')).toBeVisible();
    // Click on a known episode card (requires test data)
    // await page.click('text=Test Episode');
    // await expect(page).toHaveURL(/episode/);
  });
});
```

### E2E Environment Requirements

1. **Test Database**: Use a separate PostgreSQL database for E2E tests (via `DATABASE_URL` env var)
2. **Seed Data**: Create `prisma/seed-test.ts` that inserts a channel + episode with completed analysis
3. **Mock External APIs**: Use Playwright `route` API to intercept and mock YouTube/LLM API calls, OR run against test fixtures
4. **Queue Workers**: E2E tests should test the API layer only; do NOT run actual workers (too slow/flaky)

---

## 7. Target Coverage Plan: 80%+

### Phase 1: P0 Tests (Week 1) - Target: 45% coverage

Write tests for the 7 P0 modules. These are the largest, most complex files.

| File | Est. Lines | Est. Tests Needed |
|------|-----------|-----------------|
| `lib/queue/jobs/ingest.ts` | 60 | 6 tests |
| `lib/queue/jobs/transcribe.ts` | 62 | 5 tests |
| `lib/queue/jobs/analyze.ts` | 147 | 10 tests |
| `lib/llm/client.ts` | 201 | 12 tests |
| `lib/youtube/client.ts` | 101 | 8 tests |
| `lib/transcription/whisper.ts` | 74 | 5 tests |
| `app/api/ingest/route.ts` | 91 | 6 tests |

**Phase 1 total: ~52 tests**

### Phase 2: P1 Tests (Week 2) - Target: 70% coverage

| File | Est. Tests Needed |
|------|-----------------|
| `lib/youtube/downloader.ts` | 5 tests |
| `lib/rate-limit.ts` | 6 tests |
| `lib/env.ts` | 4 tests |
| `lib/logger.ts` | 3 tests |
| `lib/queue/config.ts` | 4 tests |
| `app/api/health/route.ts` | 3 tests |
| `app/api/episodes/[id]/full/route.ts` | 3 tests |
| `app/api/episodes/[id]/status/route.ts` | 3 tests |
| `app/api/playlists/route.ts` | 4 tests |
| `app/api/playlists/[id]/route.ts` | 4 tests |

**Phase 2 total: ~39 tests**

### Phase 3: P2 Tests (Week 3) - Target: 80% coverage

| File | Est. Tests Needed |
|------|-----------------|
| `components/visualization/TopicCluster.tsx` | 4 tests |
| `components/visualization/ArgumentThread.tsx` | 5 tests |
| `components/visualization/SpeakerTimeline.tsx` | 3 tests |
| `components/visualization/IdeaMap.tsx` | 3 tests |
| `components/visualization/ReferencePanel.tsx` | 3 tests |
| `lib/utils.ts` | 3 tests |
| Refactor existing 4 test files | +8 edge case tests |

**Phase 3 total: ~29 tests**

### Phase 4: P3 + E2E Hardening (Week 4) - Target: 85% coverage

| File | Est. Tests Needed |
|------|-----------------|
| Worker wrapper files | 6 tests |
| E2E spec enhancements | +4 critical flow tests |
| Integration tests (optional) | 3 tests |

---

## 8. Test Infrastructure Additions Needed

### 8.1 Enhanced Setup File

```typescript
// src/__tests__/setup.ts
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock console methods in tests to reduce noise
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Reset all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
```

### 8.2 Mock Data Helpers

Create `src/__tests__/helpers/` directory with:
- `mock-prisma.ts` - Prisma client mock with all models
- `factories.ts` - Episode, Channel, Analysis, Video factories
- `mock-fetch.ts` - Global fetch mock helper for LLM/YouTube APIs

### 8.3 Coverage Script

Ensure `package.json` has:
```json
{
  "scripts": {
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:all": "vitest run && playwright test"
  }
}
```

Add `@vitest/coverage-v8` to devDependencies if not present.

---

## 9. Anti-Patterns to Avoid

1. **Do NOT test internal state** - Test behavior (what the user/external system sees), not internal cache maps or private methods.
2. **Do NOT test Bullmq Worker instances directly** - Test `processXxxJob` functions; Bullmq is an external dependency.
3. **Do NOT use real database in unit tests** - Mock Prisma. Real DB = integration tests (separate suite).
4. **Do NOT make real HTTP calls in tests** - Mock `fetch` for LLM and YouTube clients.
5. **Do NOT test child_process/exec directly** - Mock `exec` for downloader and whisper tests.
6. **Do NOT share mutable state between tests** - Clear all mocks in `beforeEach`.
7. **Do NOT assert on implementation details** - Assert on return values and side effects, not the order of internal function calls unless order is a contract.

---

## 10. Quick Win Checklist

To start immediately, in this order:

- [ ] **1. Install coverage dependency**: `npm install -D @vitest/coverage-v8`
- [ ] **2. Enhance setup.ts** with console mocking and afterEach cleanup
- [ ] **3. Create mock-prisma.ts** helper with all model stubs
- [ ] **4. Write `llm/client.test.ts`** - High value, teaches mock-fetch pattern for entire codebase
- [ ] **5. Write `youtube/client.test.ts`** - Same pattern, teaches API mocking
- [ ] **6. Write `queue/jobs/ingest.test.ts`** - Core business logic, teaches Prisma+queue mocking
- [ ] **7. Write `api/ingest.test.ts`** - API layer, teaches route testing
- [ ] **8. Refactor existing tests** to AAA pattern and add edge cases
- [ ] **9. Run `npm run test:coverage`** and review report
- [ ] **10. Fix any remaining coverage gaps** to hit 80%
