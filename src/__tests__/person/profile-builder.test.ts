import { describe, it, expect } from 'vitest';
import { qualifiesForChat, MIN_EPISODES_FOR_CHAT } from '@/lib/person/profile-builder';

describe('qualifiesForChat (V3/T-V3-2)', () => {
  it('enables chat at >= MIN_EPISODES_FOR_CHAT conversations', () => {
    expect(qualifiesForChat(MIN_EPISODES_FOR_CHAT)).toBe(true);
    expect(qualifiesForChat(MIN_EPISODES_FOR_CHAT + 5)).toBe(true);
  });

  it('disables chat below the threshold', () => {
    expect(qualifiesForChat(0)).toBe(false);
    expect(qualifiesForChat(1)).toBe(false);
    expect(qualifiesForChat(MIN_EPISODES_FOR_CHAT - 1)).toBe(false);
  });

  it('never enables chat for sensitive persons regardless of episode count', () => {
    expect(qualifiesForChat(50, { sensitive: true })).toBe(false);
  });

  it('honors a custom threshold', () => {
    expect(qualifiesForChat(2, { minEpisodes: 2 })).toBe(true);
    expect(qualifiesForChat(1, { minEpisodes: 2 })).toBe(false);
  });
});
