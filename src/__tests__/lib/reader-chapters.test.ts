import { describe, it, expect } from 'vitest';
import {
  chaptersFromTopics,
  chaptersFromTimeWindows,
  deriveChapters,
  activeChapterId,
  type TopicSignal,
  type TurnForChapters,
} from '@/lib/reader/chapters';

const turn = (turnIndex: number, startMs: number): TurnForChapters => ({ turnIndex, startMs });

describe('chaptersFromTopics', () => {
  it('returns empty for no topics', () => {
    expect(chaptersFromTopics([])).toEqual([]);
  });

  it('creates a chapter per topic, sorted by time', () => {
    const topics: TopicSignal[] = [
      { label: 'B', startMs: 300000 },
      { label: 'A', startMs: 0 },
    ];
    const chapters = chaptersFromTopics(topics);
    expect(chapters.map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('drops topics within the 2-minute min gap of the previous chapter', () => {
    const topics: TopicSignal[] = [
      { label: 'A', startMs: 0 },
      { label: 'A2', startMs: 60000 }, // 1 min later — too close
      { label: 'B', startMs: 200000 }, // 3+ min later — kept
    ];
    const chapters = chaptersFromTopics(topics);
    expect(chapters).toHaveLength(2);
    expect(chapters[1].label).toBe('B');
  });

  it('assigns stable ids and turnIndex', () => {
    const chapters = chaptersFromTopics([
      { label: 'X', startMs: 0, turnIndex: 5 },
    ]);
    expect(chapters[0].id).toMatch(/^ch_/);
    expect(chapters[0].turnIndex).toBe(5);
  });
});

describe('chaptersFromTimeWindows', () => {
  it('returns empty for no turns', () => {
    expect(chaptersFromTimeWindows([])).toEqual([]);
  });

  it('produces up to 8 evenly-spaced chapters for a long episode', () => {
    const turns = Array.from({ length: 100 }, (_, i) => turn(i, i * 60_000)); // 100 min
    const chapters = chaptersFromTimeWindows(turns);
    expect(chapters.length).toBeLessThanOrEqual(8);
    expect(chapters.length).toBeGreaterThanOrEqual(1);
  });

  it('chapters have increasing turnIndex', () => {
    const turns = Array.from({ length: 50 }, (_, i) => turn(i, i * 120_000));
    const chapters = chaptersFromTimeWindows(turns);
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].turnIndex).toBeGreaterThan(chapters[i - 1].turnIndex);
    }
  });
});

describe('deriveChapters', () => {
  it('prefers topics when there are >= 2', () => {
    const topics: TopicSignal[] = [
      { label: 'A', startMs: 0 },
      { label: 'B', startMs: 300000 },
    ];
    const turns = [turn(0, 0), turn(1, 60000)];
    expect(deriveChapters(topics, turns).map((c) => c.label)).toEqual(['A', 'B']);
  });

  it('falls back to time windows when topics are sparse', () => {
    const turns = Array.from({ length: 40 }, (_, i) => turn(i, i * 100_000));
    const chapters = deriveChapters([], turns);
    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters[0].id.startsWith('chw')).toBe(true);
  });
});

describe('activeChapterId', () => {
  const chapters = chaptersFromTimeWindows([
    turn(0, 0), turn(10, 300000), turn(20, 600000), turn(30, 900000),
  ]);

  it('returns the chapter covering the given turn index', () => {
    expect(activeChapterId(chapters, 0)).toBe(chapters[0].id);
    expect(activeChapterId(chapters, 25)).toBe(chapters[2].id);
  });

  it('returns null when the turn is before the first chapter', () => {
    // first chapter turnIndex is 0 here, so 0 is covered; test a negative scenario by
    // using chapters that start later.
    const late = chaptersFromTimeWindows([turn(5, 0), turn(15, 300000)]);
    expect(activeChapterId(late, 2)).toBeNull();
  });
});
