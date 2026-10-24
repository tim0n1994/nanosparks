/**
 * YouTube Data API keys from documentation or deployment templates are not
 * credentials. Treat blank and common placeholder shapes as absent so callers
 * take the zero-key yt-dlp path instead of issuing an API request that will
 * fail with 400/403.
 */
const EXACT_PLACEHOLDER_KEYS = new Set([
  'placeholder',
  'dummy',
  'sample',
  'test',
  'changeme',
  'change-me',
  'replace-me',
  'not-configured',
  'none',
]);

const PLACEHOLDER_KEY =
  /^(?:(?:your|replace|change|insert|enter|use|placeholder|dummy|sample|test)-)?(?:(?:youtube|data)-)?(?:api-)?key(?:-(?:here|placeholder|value|example|not-set|not-provided|required))?$/;

export function configuredYouTubeApiKey(value: string | undefined): string | undefined {
  const key = value
    ?.trim()
    .toLowerCase()
    .replace(/^<+|>+$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!key || EXACT_PLACEHOLDER_KEYS.has(key) || PLACEHOLDER_KEY.test(key)) return undefined;
  return value?.trim();
}
