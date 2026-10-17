import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), getUser: vi.fn() }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/auth/clerk-client', () => ({
  ADMIN_ROLE: 'admin',
  clerkBackend: () => ({ users: { getUser: mocks.getUser } }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('request identity fallback', () => {
  it('does not grant a development identity when production authentication is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { requireUser, requireAdmin } = await import('@/lib/auth/roles');
    expect(await requireUser()).toEqual({ unauthorized: true });
    expect(await requireAdmin()).toEqual({ unauthorized: true });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('keeps the local development identity when authentication is unconfigured', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { requireUser } = await import('@/lib/auth/roles');
    expect(await requireUser()).toEqual({ userId: 'dev-user' });
  });

  it('resolves configured authentication and denies admin on backend failure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_a_real_configured_key');
    mocks.auth.mockResolvedValue({ userId: 'user-a' });
    mocks.getUser.mockRejectedValue(new Error('backend unavailable'));
    const { requireUser, requireAdmin } = await import('@/lib/auth/roles');
    expect(await requireUser()).toEqual({ userId: 'user-a' });
    expect(await requireAdmin()).toEqual({ forbidden: true });
  });
});
