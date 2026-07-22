import { describe, it, expect } from 'vitest';
import { renderCardElement, DEFAULT_BRAND } from '@/lib/publish/card-templates';
import type { CardSpec } from '@/lib/publish/types';
import { CARD_WIDTH, CARD_HEIGHT } from '@/lib/publish/cards';

describe('renderCardElement', () => {
  it('renders a quote card element', () => {
    const spec: CardSpec = {
      template: 'quote',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      payload: { quote: '好奇心是最好的天赋', speaker: '嘉宾', showTitle: '思想火花', timestampLabel: '12:30' },
    };
    const el = renderCardElement(spec, DEFAULT_BRAND) as { type: string; props: { children: unknown } };
    expect(el).toBeTruthy();
    expect(typeof el.type).toBe('function');
  });

  it('renders a list card element', () => {
    const spec: CardSpec = {
      template: 'list',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      payload: { title: '要点', items: ['一', '二', '三'] },
    };
    const el = renderCardElement(spec, DEFAULT_BRAND) as { type: string };
    expect(el).toBeTruthy();
  });

  it('renders a dialog card element', () => {
    const spec: CardSpec = {
      template: 'dialog',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      payload: { lines: [{ speaker: 'A', text: '你好' }, { speaker: 'B', text: '你好啊' }] },
    };
    const el = renderCardElement(spec, DEFAULT_BRAND);
    expect(el).toBeTruthy();
  });

  it('uses the provided brand options', () => {
    const spec: CardSpec = {
      template: 'quote',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      payload: { quote: 'x' },
    };
    const brand = { ...DEFAULT_BRAND, brandName: 'CustomBrand', accentColor: '#ff0000' };
    expect(() => renderCardElement(spec, brand)).not.toThrow();
  });

  it('renders a cover card element (大字标题+节目名)', () => {
    const spec: CardSpec = {
      template: 'cover',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      payload: { title: '好奇心', showTitle: '思想火花', episodeNumber: '42' },
    };
    const el = renderCardElement(spec, DEFAULT_BRAND);
    expect(el).toBeTruthy();
  });
});
