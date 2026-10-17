// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ userId: 'owner', shared: false, admin: false }));
const db = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn() },
  turn: { findMany: vi.fn(), findFirst: vi.fn() },
  thoughtUnit: { findMany: vi.fn() },
  participant: { findFirst: vi.fn(), update: vi.fn() },
  highlight: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  publishPackage: { findMany: vi.fn() },
  readingProgress: { upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/auth/roles', () => ({
  requireUser: async () => state.userId ? { userId: state.userId } : { unauthorized: true },
  requireAdmin: async () => state.admin ? { userId: state.userId, role: 'admin' } : { forbidden: true },
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: state.userId || null }) }));
vi.mock('@/lib/clerk-utils', () => ({ isValidClerkKey: true }));
vi.mock('@/lib/community/gate', () => ({ evaluateCommunityGate: async () => ({ unlocked: true }) }));
vi.mock('@/lib/llm/client', () => ({ OpenAIClient: vi.fn(), ClaudeClient: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getLlmSettingsForModule: vi.fn() }));
vi.mock('@/lib/extraction/model-router', () => ({ getRoutedLlmSettings: vi.fn(), getConsentStatusForConversation: vi.fn() }));
vi.mock('@/lib/publish/package-builder', () => ({ buildPublishPackages: vi.fn() }));
vi.mock('@/lib/transcription/translation', () => ({ translateEpisodeTurns: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
}));
vi.mock('@/components/reader/ReaderShell', () => ({ default: vi.fn() }));
vi.mock('@/components/publish/PublishPanel', () => ({ default: vi.fn() }));
vi.mock('@/lib/storage/provider', () => ({ createStorageProvider: vi.fn() }));

import { GET as turns } from '@/app/api/conversations/[id]/turns/route';
import { GET as read, PUT as saveProgress } from '@/app/api/conversations/[id]/read/route';
import { GET as exportConversation } from '@/app/api/conversations/[id]/export/route';
import { GET as readingProgress } from '@/app/api/conversations/[id]/reading-progress/route';
import { GET as highlights, POST as highlight, DELETE as deleteHighlight } from '@/app/api/conversations/[id]/highlights/route';
import { PATCH as participant } from '@/app/api/conversations/[id]/participants/[pid]/route';
import { GET as thoughtUnits } from '@/app/api/conversations/[id]/thought-units/route';
import { GET as streamProgress } from '@/app/api/conversations/[id]/progress/route';
import { GET as comments, POST as comment } from '@/app/api/conversations/[id]/comments/route';
import { GET as packages, POST as buildPackages } from '@/app/api/conversations/[id]/packages/route';
import { POST as translate } from '@/app/api/conversations/[id]/translate/route';
import { requireConversationAccess } from '@/lib/auth/conversation-access';
import ReadPage from '@/app/read/[conversationId]/page';
import { cookies } from 'next/headers';

const params = { params: Promise.resolve({ id: 'private-conversation', pid: 'speaker' }) };
const request = (method = 'GET', body?: unknown) => new NextRequest('http://localhost/api/conversations/private-conversation/read?format=json&highlightId=h', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = 'owner'; state.shared = false; state.admin = false;
  db.conversation.findUnique.mockImplementation(async () => ({
    id: 'private-conversation', isSharedCache: state.shared,
    corpus: { workspace: { clerkId: 'owner' } }, participants: [], title: 'Private',
  }));
  db.turn.findMany.mockResolvedValue([]);
  db.thoughtUnit.findMany.mockResolvedValue([]);
  db.highlight.findMany.mockResolvedValue([]);
  db.publishPackage.findMany.mockResolvedValue([]);
  db.highlight.create.mockImplementation(async ({ data }) => data);
  db.highlight.deleteMany.mockResolvedValue({ count: 1 });
  db.participant.findFirst.mockResolvedValue({ id: 'speaker' });
  db.participant.update.mockResolvedValue({ id: 'speaker' });
  db.readingProgress.upsert.mockResolvedValue({});
  db.readingProgress.findUnique.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (callback) => callback(db));
});

describe('conversation resource isolation', () => {
  const reads = [['turns', turns], ['read', read], ['export', exportConversation], ['reading progress', readingProgress], ['highlights', highlights], ['thought units', thoughtUnits], ['comments', comments], ['packages', packages]] as const;
  it.each(reads)('%s denies a second user before returning private data', async (_name, handler) => {
    state.userId = 'other-user';
    expect((await handler(request(), params)).status).toBe(403);
    expect(db.turn.findMany).not.toHaveBeenCalled();
    expect(db.thoughtUnit.findMany).not.toHaveBeenCalled();
    expect(db.readingProgress.findUnique).not.toHaveBeenCalled();
    expect(db.highlight.findMany).not.toHaveBeenCalled();
  });
  it.each(reads)('%s permits the owner', async (_name, handler) => {
    expect((await handler(request(), params)).status).toBe(200);
  });
  it.each(reads)('%s permits authenticated shared-cache reads', async (_name, handler) => {
    state.userId = 'other-user'; state.shared = true;
    expect((await handler(request(), params)).status).toBe(200);
  });
  it.each(reads)('%s denies anonymous shared-cache reads', async (_name, handler) => {
    state.userId = ''; state.shared = true;
    expect((await handler(request(), params)).status).toBe(401);
    expect(db.conversation.findUnique).not.toHaveBeenCalled();
  });
  it('rejects unauthorized SSE before opening the stream', async () => {
    state.userId = 'other-user';
    const response = await streamProgress(request(), params);
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
  it.each([['packages', buildPackages], ['translate', translate], ['participant', participant]] as const)('denies shared-cache global writes: %s', async (_name, handler) => {
    state.userId = 'other-user'; state.shared = true;
    expect((await handler(request('POST', { target: 'zh', name: 'Changed' }), params)).status).toBe(403);
    expect(db.turn.findMany).not.toHaveBeenCalled();
    expect(db.participant.update).not.toHaveBeenCalled();
  });
  it('denies personal comments on inaccessible content', async () => {
    state.userId = 'other-user';
    expect((await comment(request('POST', { turnId: 't', note: 'Comment' }), params)).status).toBe(403);
    expect(db.highlight.create).not.toHaveBeenCalled();
  });
  it('denies editing another user’s speaker attribution', async () => {
    state.userId = 'other-user';
    expect((await participant(request('PATCH', { name: 'Attacker' }), params)).status).toBe(403);
    expect(db.participant.update).not.toHaveBeenCalled();
  });
  it('denies personal progress writes for an inaccessible conversation', async () => {
    state.userId = 'other-user';
    expect((await saveProgress(request('PUT', { turnIndex: 0 }), params)).status).toBe(403);
    expect(db.readingProgress.upsert).not.toHaveBeenCalled();
  });
  it('scopes shared-cache highlights and deletions to the current reader', async () => {
    state.userId = 'other-user'; state.shared = true;
    expect((await highlight(request('POST', { note: 'My note' }), params)).status).toBe(200);
    expect(db.highlight.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'other-user' }) }));
    await deleteHighlight(request('DELETE'), params);
    expect(db.highlight.deleteMany).toHaveBeenCalledWith({ where: { id: 'h', userId: 'other-user', conversationId: 'private-conversation' } });
  });
});

describe('conversation guard policy', () => {
  it('returns 404 for missing resources', async () => {
    db.conversation.findUnique.mockResolvedValue(null);
    const result = await requireConversationAccess('missing', 'read');
    expect('response' in result && result.response.status).toBe(404);
  });
  it('denies a private resource with no owner', async () => {
    db.conversation.findUnique.mockResolvedValue({ isSharedCache: false, corpus: { workspace: { clerkId: null } } });
    const result = await requireConversationAccess('legacy', 'read');
    expect('response' in result && result.response.status).toBe(403);
  });
  it.each(['read', 'write'] as const)('allows authoritative admins to %s', async (mode) => {
    state.userId = 'admin-user'; state.admin = true;
    expect(await requireConversationAccess('private-conversation', mode)).toEqual({ userId: 'admin-user' });
  });
  it('allows owners to write', async () => {
    expect(await requireConversationAccess('private-conversation', 'write')).toEqual({ userId: 'owner' });
  });
});

describe('reader server page boundary', () => {
  it('redirects anonymous readers before loading content', async () => {
    state.userId = '';
    await expect(ReadPage({ params: Promise.resolve({ conversationId: 'private-conversation' }) })).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(db.conversation.findUnique).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });
  it('stops another user before loading the private reader payload', async () => {
    state.userId = 'other-user';
    await expect(ReadPage({ params: Promise.resolve({ conversationId: 'private-conversation' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(db.conversation.findUnique).toHaveBeenCalledTimes(1);
    expect(cookies).not.toHaveBeenCalled();
    expect(db.thoughtUnit.findMany).not.toHaveBeenCalled();
  });
});

describe('reading progress validation and first completion', () => {
  it.each([
    { turnIndex: -1 }, { turnIndex: 1.5 }, { turnIndex: '1' }, { turnIndex: 2_147_483_648 },
    { scrollRatio: -0.01 }, { scrollRatio: 1.01 }, { scrollRatio: null }, { scrollRatio: '0.8' },
  ])('rejects invalid progress %j without persistence', async (body) => {
    expect((await saveProgress(request('PUT', body), params)).status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects non-finite JSON numbers', async () => {
    const req = new NextRequest('http://localhost/read', { method: 'PUT', body: '{"scrollRatio":1e400}' });
    expect((await saveProgress(req, params)).status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('preserves the original completion timestamp on a later read', async () => {
    const firstCompletedAt = new Date('2026-01-01T00:00:00Z');
    db.readingProgress.upsert.mockResolvedValue({ completedAt: firstCompletedAt });
    const response = await saveProgress(request('PUT', { turnIndex: 20, scrollRatio: 0.95 }), params);
    expect((await response.json()).progress.completedAt).toBe(firstCompletedAt.toISOString());
    expect(db.readingProgress.upsert.mock.calls[0][0].update).toEqual({ turnIndex: 20, scrollRatio: 0.95 });
    expect(db.readingProgress.updateMany).not.toHaveBeenCalled();
  });
  it('sets completion only while it is null, preserving a concurrent first completion', async () => {
    state.userId = 'other-user'; state.shared = true;
    const concurrentFirst = new Date('2026-01-02T00:00:00Z');
    db.readingProgress.upsert.mockResolvedValue({ completedAt: null });
    db.readingProgress.updateMany.mockResolvedValue({ count: 0 });
    db.readingProgress.findUnique.mockResolvedValue({ completedAt: concurrentFirst });
    const response = await saveProgress(request('PUT', { turnIndex: 0, scrollRatio: 0.7 }), params);
    expect(response.status).toBe(200);
    expect(db.readingProgress.updateMany).toHaveBeenCalledWith({
      where: { userId: 'other-user', conversationId: 'private-conversation', completedAt: null },
      data: { completedAt: expect.any(Date) },
    });
    expect((await response.json()).progress.completedAt).toBe(concurrentFirst.toISOString());
  });
  it('does not mark an unfinished read completed', async () => {
    db.readingProgress.upsert.mockResolvedValue({ completedAt: null });
    expect((await saveProgress(request('PUT', { turnIndex: 0, scrollRatio: 0.69 }), params)).status).toBe(200);
    expect(db.readingProgress.updateMany).not.toHaveBeenCalled();
    expect(db.readingProgress.upsert.mock.calls[0][0].create.completedAt).toBeUndefined();
  });
});
