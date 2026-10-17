import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextFetchEvent } from 'next/server';

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: vi.fn(),
  createRouteMatcher: (patterns: string[]) => (request: NextRequest) =>
    patterns.some((pattern) => new RegExp(`^${pattern}$`).test(request.nextUrl.pathname)),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('unconfigured authentication middleware', () => {
  it.each(['/api/conversations/private/read', '/read/private', '/admin'])('blocks %s in production', async (path) => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: middleware } = await import('@/proxy');
    const response = await middleware(new NextRequest(`http://localhost${path}`), {} as NextFetchEvent);
    expect(response?.status).toBe(503);
  });

  it('leaves health reachable when production auth is misconfigured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: middleware } = await import('@/proxy');
    const response = await middleware(new NextRequest('http://localhost/api/health'), {} as NextFetchEvent);
    expect(response?.status).toBe(200);
  });

  it('preserves local development routing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { default: middleware } = await import('@/proxy');
    const response = await middleware(new NextRequest('http://localhost/read/example'), {} as NextFetchEvent);
    expect(response?.status).toBe(200);
  });
});
