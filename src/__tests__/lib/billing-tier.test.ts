import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { setting: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { getUserTier, isPro, monthlyQuotaFor, PRO_MONTHLY_QUOTA, FREE_MONTHLY_QUOTA } from '@/lib/billing/tier';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUserTier', () => {
  it('returns pro when the Setting value is "pro"', async () => {
    prismaMock.setting.findUnique.mockResolvedValue({ value: 'pro' });
    expect(await getUserTier('user_pro')).toBe('pro');
  });

  it('returns free when no Setting exists', async () => {
    prismaMock.setting.findUnique.mockResolvedValue(null);
    expect(await getUserTier('user_free')).toBe('free');
  });

  it('returns free on DB error (safe default)', async () => {
    prismaMock.setting.findUnique.mockRejectedValue(new Error('db down'));
    expect(await getUserTier('user_x')).toBe('free');
  });
});

describe('isPro', () => {
  it('returns true only for pro', () => {
    expect(isPro('pro')).toBe(true);
    expect(isPro('free')).toBe(false);
  });
});

describe('monthlyQuotaFor', () => {
  it('returns 60 for pro (PRD §7)', () => {
    expect(monthlyQuotaFor('pro')).toBe(60);
  });

  it('returns 4 for free (PRD §7)', () => {
    expect(monthlyQuotaFor('free')).toBe(4);
  });
});

describe('quota constants', () => {
  it('matches PRD §7', () => {
    expect(PRO_MONTHLY_QUOTA).toBe(60);
    expect(FREE_MONTHLY_QUOTA).toBe(4);
  });
});
