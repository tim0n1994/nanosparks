import { afterEach, describe, expect, it } from 'vitest';

import { configuredYouTubeApiKey } from '@/lib/youtube/api-key';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/nanosparks_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
  CLERK_SECRET_KEY: "secret-placeholder-fixture",
};

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

async function loadValidatedEnv(youtubeKey: string | undefined) {
  process.env = { ...originalEnv, ...REQUIRED_ENV };
  if (youtubeKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = youtubeKey;
  const { validateEnv } = await import('@/lib/env');
  return validateEnv();
}

describe('YouTube API key configuration', () => {
  it.each([
    undefined,
    '',
    '   ',
    'your_youtube_api_key_here',
    'your-api-key',
    'YOUR_API_KEY',
    'placeholder',
    'CHANGE_ME',
    '<your-key>',
  ])('treats %s as not configured', (value) => {
    expect(configuredYouTubeApiKey(value)).toBeUndefined();
  });

  it('keeps a real key unchanged', () => {
    expect(configuredYouTubeApiKey('AIzaSyDummyRealShape123')).toBe('AIzaSyDummyRealShape123');
  });

  it.each([undefined, '', 'your_youtube_api_key_here'])('loads environment with absent key %s', async (value) => {
    const loaded = await loadValidatedEnv(value);
    expect(loaded.YOUTUBE_API_KEY).toBeUndefined();
  });

  it('passes a configured key through validation', async () => {
    await expect(loadValidatedEnv('AIzaSyConfiguredKey123')).resolves.toMatchObject({
      YOUTUBE_API_KEY: 'AIzaSyConfiguredKey123',
    });
  });
});
