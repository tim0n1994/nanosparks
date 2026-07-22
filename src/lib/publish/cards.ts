/**
 * Card builders (B1) — PRD §B1 卡片渲染规格.
 *
 * 1242x1656 (3:4), three templates (金句/清单/对谈). The layout logic (font-size
 * tier by char count, line wrapping, vertical balance) is pure and tested here.
 * The actual React→SVG→PNG rasterization lives in renderCardPng() which lazily
 * imports satori+resvg so the layout layer stays dependency-light and testable.
 */

import type {
  CardSpec,
  CardTemplate,
  QuoteCardPayload,
  ListCardPayload,
  DialogCardPayload,
  ThoughtUnitLike,
  CoverCardPayload,
} from './types';

export const CARD_WIDTH = 1242;
export const CARD_HEIGHT = 1656;

/**
 * Pick a font-size tier (in px) for a quote based on its character count.
 * PRD: 字数→字号档位表自适应折行. Longer quotes shrink so they fit one card.
 */
export function quoteFontSize(text: string): number {
  const len = text.length;
  if (len <= 24) return 96;
  if (len <= 48) return 76;
  if (len <= 80) return 60;
  if (len <= 120) return 48;
  return 40;
}

/** Wrap text into lines that fit a max-width at a given font size (approx CJK width). */
export function wrapText(text: string, maxCharsPerLine: number): string[] {
  if (maxCharsPerLine <= 0) return [text];
  const lines: string[] = [];
  let buf = '';
  let count = 0;
  for (const ch of text) {
    buf += ch;
    count += isWide(ch) ? 2 : 1;
    if (count >= maxCharsPerLine) {
      lines.push(buf);
      buf = '';
      count = 0;
    }
  }
  if (buf) lines.push(buf);
  return lines.length > 0 ? lines : [text];
}

/** CJK characters take roughly 2x the width of ASCII. */
function isWide(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x4e00 && code <= 0x9fff;
}

/** Approx chars-per-line for a font size and card content width (px). */
export function charsPerLine(fontSize: number, contentWidthPx: number): number {
  // CJK glyph ~ fontSize px wide; ASCII ~ fontSize/2. Use CJK as the safe floor.
  return Math.floor(contentWidthPx / fontSize);
}

/** Build a 金句 card spec from a quote thought unit. */
export function buildQuoteCard(quote: ThoughtUnitLike, showTitle?: string): CardSpec {
  const payload: QuoteCardPayload = {
    quote: quote.text,
    speaker: quote.speaker,
    showTitle,
    timestampLabel: quote.startMs ? formatMs(quote.startMs) : undefined,
  };
  return { template: 'quote', width: CARD_WIDTH, height: CARD_HEIGHT, payload };
}

/** Build a 清单 card spec from a list of points. */
export function buildListCard(title: string, items: string[], showTitle?: string): CardSpec {
 const payload: ListCardPayload = { title, items: items.slice(0, 5), showTitle };
  return { template: 'list', width: CARD_WIDTH, height: CARD_HEIGHT, payload };
}

/** Build a 对谈 card spec from two speakers' lines. */
export function buildDialogCard(lines: Array<{ speaker: string; text: string }>, showTitle?: string): CardSpec {
  const payload: DialogCardPayload = { lines: lines.slice(0, 4), showTitle };
  return { template: 'dialog', width: CARD_WIDTH, height: CARD_HEIGHT, payload };
}

/** Build a 封面 card spec (PRD §B1 封面模板：大字标题+节目名+品牌角标). */
export function buildCoverCard(title: string, showTitle?: string, episodeNumber?: string): CardSpec {
  const payload: CoverCardPayload = { title, showTitle, episodeNumber };
  return { template: 'cover', width: CARD_WIDTH, height: CARD_HEIGHT, payload };
}

/** Format ms as mm:ss or h:mm:ss for card footers. */
export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Pick the best 3 quote cards from a set of insight thought units (PRD: 金句墙 3-5). */
export function pickQuoteCards(units: ThoughtUnitLike[], showTitle?: string, limit = 3): CardSpec[] {
  return units.slice(0, limit).map((u) => buildQuoteCard(u, showTitle));
}

/** Pick the best list card from key-point thought units. */
export function pickListCard(points: ThoughtUnitLike[], showTitle?: string, title?: string): CardSpec {
  return buildListCard(title ?? '要点清单', points.slice(0, 5).map((p) => p.text), showTitle);
}

/**
 * Rasterize a card spec to PNG. Lazily imports satori + resvg so the layout
 * layer (and its tests) don't require the rendering deps. Throws a typed error
 * when the rendering deps aren't installed so the caller can fall back.
 */
export async function renderCardPng(_spec: CardSpec): Promise<Buffer> {
  // Lazy import keeps the test surface free of native/JSX deps. The optional
  // renderer deps (satori, @resvg/resvg-js) are not part of the base install;
  // their absence is surfaced as a clear typed error so the caller can degrade.
  // The AIGC implicit label (PRD §8) is embedded into the rendered PNG so every
  // exported card carries the 服务商编码 + 内容编号 in its metadata.
  type SatoriFn = (el: unknown, opts: Record<string, unknown>) => Promise<string>;
  let satori: SatoriFn;
  let ResvgCtor: new (svg: string, opts?: unknown) => { render: () => { asPng: Buffer } };
  try {
    // Use computed module ids so bundlers cannot statically resolve the optional
    // deps (absent from the base install). The try/catch turns a missing dep
    // into a clear typed error instead of a build-time failure.
    const SATORI_MOD = 'satori';
    const RESVG_MOD = '@resvg/resvg-js';
    const satoriMod: any = await import(SATORI_MOD);
    const resvgMod: any = await import(RESVG_MOD);
    satori = (satoriMod.default ?? satoriMod) as SatoriFn;
    ResvgCtor = resvgMod.Resvg as typeof ResvgCtor;
  } catch {
    throw new Error('Card rendering requires `satori` and `@resvg/resvg-js` deps');
  }
  const svg = await satori(cardElement(_spec), {
    width: _spec.width,
    height: _spec.height,
    fonts: await loadSatoriFonts(),
    // PRD §B1: emoji 用 twemoji SVG — satori's loadAdditionalAsset fetches the
    // SVG representation of emoji codepoints so they render correctly in cards.
    loadAdditionalAsset: async (code: string, segment: string) => {
      // satori passes emoji codepoints here; fetch twemoji SVG.
      try {
        const MOD = 'twemoji-parser';
        const mod: any = await import(MOD);
        const entities = mod.parse(segment);
        if (entities.length > 0) {
          const codepoint = entities[0].text;
          const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${codepoint}.svg`;
          const resp = await fetch(url);
          if (resp.ok) return { data: await resp.text() };
        }
      } catch { /* emoji not critical — fallback to text glyph */ }
    },
  });
  const resvg = new ResvgCtor(svg);
  const png = resvg.render().asPng;
  // Embed the AIGC implicit label into the exported PNG metadata (PRD §8 标识办法).
  const { embedAigcLabelInPng, makeAigcLabel } = await import('./aigc-png');
  return embedAigcLabelInPng(png, makeAigcLabel(`card:${_spec.template}:${_spec.width}x${_spec.height}`));
}

/** Load font data for satori (PRD §B1: 思源黑体/霞鹜文楷 OFL). Tries env → macOS → Linux. */
async function loadSatoriFonts(): Promise<Array<{ name: string; data: Buffer; weight: number; style: string }>> {
  const { readFileSync, existsSync } = await import('node:fs');
  const candidates = [
    { path: process.env.SATORI_FONT_PATH || '', name: 'NotoSansSC' },
    { path: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', name: 'Arial Unicode' },
    { path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', name: 'NotoSansCJK' },
  ].filter((c) => c.path && existsSync(c.path));
  for (const c of candidates) {
    try {
      return [{ name: c.name, data: readFileSync(c.path), weight: 400, style: 'normal' }];
    } catch { /* try next */ }
  }
  return [];
}

/** Placeholder element builder — replaced by the JSX template once satori is wired. */
// Real JSX templates live in card-templates.tsx (satori needs actual JSX).
function cardElement(spec: CardSpec): unknown {
  // Lazy require so the pure layout layer (and its tests) don't pull JSX at
  // import time; only renderCardPng reaches this path.
  const { renderCardElement } = require('./card-templates');
  return renderCardElement(spec);
}

export type { CardTemplate, CardSpec };
