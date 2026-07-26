import { describe, it, expect } from 'vitest';
import { isQuestion, hasVagueQuantifier, avgFollowupDepth, classifyOpening, transitionPhraseCounts } from '@/lib/person/host-fingerprint';

describe('isQuestion', () => {
  it('detects question marks (en + zh)', () => {
    expect(isQuestion('What do you think?')).toBe(true);
    expect(isQuestion('你觉得呢？')).toBe(true);
  });
  it('detects question-word starters', () => {
    expect(isQuestion('How does that work')).toBe(true);
    expect(isQuestion('为什么会这样')).toBe(true);
    expect(isQuestion('So what is X')).toBe(true);
  });
  it('rejects plain statements', () => {
    expect(isQuestion('I agree completely.')).toBe(false);
    expect(isQuestion('这是对的')).toBe(false);
    expect(isQuestion('')).toBe(false);
  });
});

describe('hasVagueQuantifier', () => {
  it('flags vague quantifiers (en + zh)', () => {
    expect(hasVagueQuantifier('there are a lot of reasons')).toBe(true);
    expect(hasVagueQuantifier('挺多的')).toBe(true);
    expect(hasVagueQuantifier('around fifty')).toBe(true);
  });
  it('passes precise statements', () => {
    expect(hasVagueQuantifier('exactly 42')).toBe(false);
  });
});

describe('avgFollowupDepth', () => {
  it('averages runs of consecutive questions (>=2)', () => {
    // mask: Q Q . Q Q Q .  -> chains [2,3] -> avg 2.5
    expect(avgFollowupDepth([true, true, false, true, true, true, false])).toBe(2.5);
  });
  it('ignores singletons (isolated questions are not chains)', () => {
    expect(avgFollowupDepth([true, false, true, false])).toBe(0);
  });
  it('returns 0 for empty / all-false', () => {
    expect(avgFollowupDepth([])).toBe(0);
    expect(avgFollowupDepth([false, false])).toBe(0);
  });
});

describe('classifyOpening', () => {
  it('classifies background/direct/personal openings', () => {
    expect(classifyOpening('背景是…')).toBe('background');
    expect(classifyOpening('上次我们聊到…')).toBe('background');
    expect(classifyOpening('I think the key issue is…')).toBe('personal');
    expect(classifyOpening('What is your view on AI?')).toBe('direct');
  });
});

describe('transitionPhraseCounts', () => {
  it('counts habitual connectors at turn starts', () => {
    const c = transitionPhraseCounts(['So next...', '好的，那我们', 'Okay moving on', 'random start']);
    expect(c['so']).toBe(1);
    expect(c['好的']).toBe(1);
    expect(c['okay']).toBe(1);
  });
});
