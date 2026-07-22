/**
 * Packages PATCH route tests (B2) — status transition + backfill drives the
 * §9 packageToPublishedRate metric. Verifies ownership guard + audit write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  auth: vi.fn(),
  isValidClerkKey: false,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { publishPackage: { findUnique: mocks.findUnique, update: mocks.update } },
}));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));
vi.mock('@/lib/clerk-utils', () => ({ get isValidClerkKey() { return mocks.isValidClerkKey; } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { PATCH } from '@/app/api/packages/[id]/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/packages/pkg_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isValidClerkKey = false; // dev: userId = 'dev-user'
  mocks.audit.mockResolvedValue(undefined);
});

describe('PATCH /api/packages/:id', () => {
  it('updates status + publishedUrl and writes an audit entry', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'pkg_1', userId: 'dev-user' });
    mocks.update.mockResolvedValue({ id: 'pkg_1', status: 'published', publishedUrl: 'https://x/p/1' });

    const res = await PATCH(
      makeRequest({ status: 'published', publishedUrl: 'https://x/p/1' }),
      { params: Promise.resolve({ id: 'pkg_1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.package.status).toBe('published');
    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'export',
      resourceType: 'publish_package',
      resourceId: 'pkg_1',
    }));
  });

  it('forbids updating a package owned by another user', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'pkg_1', userId: 'someone_else' });

    const res = await PATCH(
      makeRequest({ status: 'published' }),
      { params: Promise.resolve({ id: 'pkg_1' }) },
    );
    expect(res.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing package', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await PATCH(
      makeRequest({ status: 'published' }),
      { params: Promise.resolve({ id: 'pkg_1' }) },
    );
    expect(res.status).toBe(404);
  });

  it('rejects an invalid status enum', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'pkg_1', userId: 'dev-user' });
    const res = await PATCH(
      makeRequest({ status: 'bogus' }),
      { params: Promise.resolve({ id: 'pkg_1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('rejects an invalid publishedUrl', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'pkg_1', userId: 'dev-user' });
    const res = await PATCH(
      makeRequest({ publishedUrl: 'not-a-url' }),
      { params: Promise.resolve({ id: 'pkg_1' }) },
    );
    expect(res.status).toBe(400);
  });
});
