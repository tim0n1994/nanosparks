import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import satori from 'satori';
import { renderCardElement, DEFAULT_BRAND } from '@/lib/publish/card-templates';
import type { CardSpec } from '@/lib/publish/types';
import { CARD_WIDTH, CARD_HEIGHT } from '@/lib/publish/cards';

// GHSA-wx4j-mvgx-mqwp: the value reaches an SVG attribute. The injected probe
// is an inert element so the test stays a harmless serialization check.
const COLOR_PROBE = 'red"/><path data-nanosparks-probe="safe"/><text fill="red';
const COLOR_PROBE_ELEMENT = '<path data-nanosparks-probe="safe"/>';
const COLOR_PROBE_ESCAPED =
  'red&quot;/&gt;&lt;path data-nanosparks-probe=&quot;safe&quot;/&gt;&lt;text fill=&quot;red';
const TEXT_PROBE = '<path data-nanosparks-probe="safe"/>';

function loadProbeFont(): Array<{
  name: string;
  data: Buffer;
  weight: 400;
  style: 'normal';
}> {
  const candidates = [
    process.env.SATORI_FONT_PATH,
    resolve('node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf'),
    resolve(
      'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf',
    ),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  ];
  const path = candidates.find((candidate) => candidate && existsSync(candidate));

  if (!path) {
    throw new Error(
      'Satori security test requires SATORI_FONT_PATH or a bundled/system font',
    );
  }

  return [{ name: 'probe', data: readFileSync(path), weight: 400, style: 'normal' }];
}

async function renderQuoteCard(spec: CardSpec): Promise<string> {
  return satori(renderCardElement(spec), {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: loadProbeFont(),
    embedFont: false,
  });
}

describe('satori SVG serialization security', () => {
  it('escapes an inert style attribute probe without changing it into markup', async () => {
    const spec: CardSpec = {
      template: 'quote',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      payload: { quote: 'safe' },
    };
    const brand = { ...DEFAULT_BRAND, accentColor: COLOR_PROBE };
    const svg = await satori(renderCardElement(spec, brand), {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fonts: loadProbeFont(),
      embedFont: false,
    });

    expect(svg).not.toContain(COLOR_PROBE_ELEMENT);
    expect(svg).toContain(COLOR_PROBE_ESCAPED);
  });

  it('keeps quote text as escaped text in the public card template', async () => {
    const spec: CardSpec = {
      template: 'quote',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      payload: { quote: TEXT_PROBE },
    };
    const svg = await renderQuoteCard(spec);

    expect(svg).not.toContain(TEXT_PROBE);
    expect(svg).toContain('&lt;');
    expect(svg).toContain('safe');
  });
});
