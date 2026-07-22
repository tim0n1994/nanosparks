import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    setting: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { consumeInviteCode, isValidInviteCode } from '@/lib/billing/invite-codes';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('consumeInviteCode', () => {
  it('consumes a valid unused code', async () => {
    prismaMock.setting.findUnique.mockResolvedValue({ key: 'invite.NSP-ABC', value: 'unused' });
    prismaMock.setting.update.mockResolvedValue({});
    const ok = await consumeInviteCode('NSP-ABC');
    expect(ok).toBe(true);
    expect(prismaMock.setting.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'invite.NSP-ABC' }, data: { value: 'consumed' } }),
    );
  });

  it('rejects an already-consumed code', async () => {
    prismaMock.setting.findUnique.mockResolvedValue({ key: 'invite.NSP-ABC', value: 'consumed' });
    expect(await consumeInviteCode('NSP-ABC')).toBe(false);
  });

  it('rejects a non-existent code', async () => {
    prismaMock.setting.findUnique.mockResolvedValue(null);
    expect(await consumeInviteCode('NSP-NOPE')).toBe(false);
  });
});

describe('isValidInviteCode', () => {
  it('returns true for unused codes', async () => {
    prismaMock.setting.findUnique.mockResolvedValue({ value: 'unused' });
    expect(await isValidInviteCode('NSP-X')).toBe(true);
  });

  it('returns false for consumed/missing codes', async () => {
    prismaMock.setting.findUnique.mockResolvedValue({ value: 'consumed' });
    expect(await isValidInviteCode('NSP-X')).toBe(false);
    prismaMock.setting.findUnique.mockResolvedValue(null);
    expect(await isValidInviteCode('NSP-X')).toBe(false);
  });
});
