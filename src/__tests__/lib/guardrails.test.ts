import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkIngestGuardrails, costBreakerTripped, type GuardrailConfig } from '@/lib/guardrails';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    conversation: { count: vi.fn(), findFirst: vi.fn() },
    setting: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const cfg: GuardrailConfig = {
  maxConcurrentPerUser: 1,
  maxDailyPerUser: 5,
  maxAudioDurationSec: 4 * 3600,
  costCircuitBreakerCny: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.conversation.count.mockReset();
  prismaMock.conversation.count.mockResolvedValue(0);
});

describe('checkIngestGuardrails', () => {
  it('passes when under all limits', async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);
    prismaMock.conversation.count.mockResolvedValue(0);
    const r = await checkIngestGuardrails('user_A', { durationSec: 3600 }, cfg);
    expect(r.ok).toBe(true);
  });

  it('rejects audio exceeding the duration ceiling', async () => {
    const r = await checkIngestGuardrails('user_A', { durationSec: 5 * 3600 }, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('duration');
      expect(r.message).toMatch(/超过上限/);
    }
  });

  it('rejects when concurrent in-flight count is at the cap', async () => {
    // findFirst returns an in-flight conversation → concurrent limit hit
    prismaMock.conversation.findFirst.mockResolvedValue({ id: 'conv_inflight' });
    prismaMock.conversation.count.mockResolvedValue(0); // daily count
    const r = await checkIngestGuardrails('user_A', {}, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('concurrent');
  });

  it('rejects when daily ingest count is at the cap', async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null); // no in-flight
    prismaMock.conversation.count.mockResolvedValue(5); // daily cap hit
    const r = await checkIngestGuardrails('user_A', {}, cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('daily');
  });

  it('skips the duration check when no duration is provided', async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);
    const r = await checkIngestGuardrails('user_A', {}, cfg);
    expect(r.ok).toBe(true);
  });
});

describe('costBreakerTripped', () => {
  it('returns false below the CNY budget', () => {
    // 0.3 USD ≈ 2.16 CNY < 3
    expect(costBreakerTripped(0.3, cfg)).toBe(false);
  });

  it('returns true when cost exceeds the CNY budget', () => {
    // 0.5 USD ≈ 3.6 CNY > 3
    expect(costBreakerTripped(0.5, cfg)).toBe(true);
  });
});
