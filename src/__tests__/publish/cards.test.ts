import { describe, it, expect } from 'vitest';
import {
  quoteFontSize,
  wrapText,
  charsPerLine,
  buildQuoteCard,
  buildListCard,
  buildDialogCard,
  pickQuoteCards,
  formatMs,
  CARD_WIDTH,
  CARD_HEIGHT,
} from '@/lib/publish/cards';

describe('card dimensions', () => {
  it('uses 1242x1656 (3:4) per PRD', () => {
    expect(CARD_WIDTH).toBe(1242);
    expect(CARD_HEIGHT).toBe(1656);
    expect(CARD_HEIGHT / CARD_WIDTH).toBeCloseTo(4 / 3, 1);
  });
});

describe('quoteFontSize', () => {
  it('returns larger sizes for shorter quotes', () => {
    expect(quoteFontSize('短句')).toBe(96);
    expect(quoteFontSize('a'.repeat(24))).toBe(96);
  });

  it('steps down as length grows', () => {
    expect(quoteFontSize('a'.repeat(30))).toBe(76);
    expect(quoteFontSize('a'.repeat(60))).toBe(60);
    expect(quoteFontSize('a'.repeat(100))).toBe(48);
    expect(quoteFontSize('a'.repeat(150))).toBe(40);
  });
});

describe('wrapText', () => {
  it('wraps long CJK text into multiple lines', () => {
    const lines = wrapText('一二三四五六七八九十', 4);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('returns the whole string as one line when under the limit', () => {
    expect(wrapText('短', 10)).toEqual(['短']);
  });

  it('treats CJK chars as width 2', () => {
    // 2 CJK chars = width 4, limit 4 -> one line of 2 chars
    const lines = wrapText('一二三', 4);
    expect(lines[0]).toBe('一二');
  });
});

describe('charsPerLine', () => {
  it('scales content width by font size', () => {
    expect(charsPerLine(48, 1000)).toBe(Math.floor(1000 / 48));
  });
});

describe('card builders', () => {
  const quote = { id: 'q1', text: '好奇心是最好的天赋', speaker: '嘉宾', startMs: 150000 };

  it('builds a quote card with attribution + timestamp', () => {
    const spec = buildQuoteCard(quote, '测试节目');
    expect(spec.template).toBe('quote');
    expect(spec.width).toBe(1242);
    const p = spec.payload as { quote: string; speaker: string; showTitle: string; timestampLabel: string };
    expect(p.quote).toBe('好奇心是最好的天赋');
    expect(p.speaker).toBe('嘉宾');
    expect(p.showTitle).toBe('测试节目');
    expect(p.timestampLabel).toBe('2:30');
  });

  it('builds a list card capped at 5 items', () => {
    const spec = buildListCard('要点', ['a', 'b', 'c', 'd', 'e', 'f']);
    const p = spec.payload as { items: string[] };
    expect(p.items).toHaveLength(5);
  });

  it('builds a dialog card capped at 4 lines', () => {
    const spec = buildDialogCard([
      { speaker: 'A', text: '1' },
      { speaker: 'B', text: '2' },
      { speaker: 'A', text: '3' },
      { speaker: 'B', text: '4' },
      { speaker: 'A', text: '5' },
    ]);
    const p = spec.payload as { lines: unknown[] };
    expect(p.lines).toHaveLength(4);
  });
});

describe('pickQuoteCards', () => {
  it('returns up to N quote cards', () => {
    const units = [
      { id: '1', text: '一' },
      { id: '2', text: '二' },
      { id: '3', text: '三' },
      { id: '4', text: '四' },
    ];
    const cards = pickQuoteCards(units, 'show', 3);
    expect(cards).toHaveLength(3);
    expect(cards[0].template).toBe('quote');
  });
});

describe('formatMs', () => {
  it('formats mm:ss under an hour', () => {
    expect(formatMs(150000)).toBe('2:30');
  });

  it('formats h:mm:ss over an hour', () => {
    expect(formatMs(3 * 3600 * 1000 + 5 * 60000)).toBe('3:05:00');
  });
});
