/**
 * Card JSX templates (B1) — real satori elements for the three card templates
 * + the cover. PRD §B1: 金句卡 / 清单卡 / 对谈卡 / 封面.
 *
 * satori renders React-like elements to SVG. These are pure presentational
 * components (no hooks); they take a CardSpec payload + brand options and
 * return the element tree. Tested for structure via a lightweight render helper.
 *
 * Kept in a .tsx file because satori needs real JSX (the object-shorthand used
 * before was a placeholder).
 */

import type {
  CardSpec,
  QuoteCardPayload,
  ListCardPayload,
  DialogCardPayload,
  CoverCardPayload,
} from './types';
import { quoteFontSize, wrapText, charsPerLine } from './cards';

export interface BrandOptions {
  brandName: string;
  accentColor: string;
  bgGradient?: [string, string];
}

export const DEFAULT_BRAND: BrandOptions = {
  brandName: 'NanoSparks',
  accentColor: '#111827',
  bgGradient: ['#ffffff', '#f9fafb'],
};

/** Shared card frame: gradient background + brand corner + content area. */
function CardFrame({
  spec,
  brand,
  children,
}: {
  spec: CardSpec;
  brand: BrandOptions;
  children: React.ReactNode;
}) {
  const [from, to] = brand.bgGradient ?? ['#ffffff', '#f9fafb'];
  return (
    <div
      style={{
        width: spec.width,
        height: spec.height,
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(160deg, ${from}, ${to})`,
        padding: 80,
        boxSizing: 'border-box',
        fontFamily: 'sans-serif',
        color: '#111827',
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {children}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 28, color: '#9ca3af' }}>
        <span>{brand.brandName}</span>
      </div>
    </div>
  );
}

/** Big decorative open-quote glyph used by the quote card. */
function OpenQuote({ color }: { color: string }) {
  return <div style={{ fontSize: 200, lineHeight: 0.8, color, marginBottom: 24 }}>{'"'}</div>;
}

/** 金句卡: large quote + speaker + show + timestamp. */
export function QuoteCard({ spec, brand }: { spec: CardSpec; brand: BrandOptions }) {
  const p = spec.payload as QuoteCardPayload;
  const fs = quoteFontSize(p.quote);
  const lines = wrapText(p.quote, charsPerLine(fs, spec.width - 160));
  return (
    <CardFrame spec={spec} brand={brand}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <OpenQuote color={brand.accentColor} />
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', fontSize: fs, fontWeight: 700, lineHeight: 1.3, marginBottom: 8 }}>{line}</div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 48, fontSize: 32, color: '#6b7280' }}>
          {p.speaker ? <div style={{ display: 'flex' }}>{p.speaker}</div> : null}
          {(p.showTitle || p.timestampLabel) && (
            <div style={{ display: 'flex', fontSize: 26, color: '#9ca3af', marginTop: 8 }}>
              {p.showTitle} {p.timestampLabel}
            </div>
          )}
        </div>
      </div>
    </CardFrame>
  );
}

/** 清单卡: title + bullet items. */
export function ListCard({ spec, brand }: { spec: CardSpec; brand: BrandOptions }) {
  const p = spec.payload as ListCardPayload;
  return (
    <CardFrame spec={spec} brand={brand}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, marginBottom: 40 }}>{p.title}</div>
        {p.items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 16, marginBottom: 24, fontSize: 36, lineHeight: 1.4 }}>
            <span style={{ color: brand.accentColor, fontWeight: 700 }}>{i + 1}.</span>
            <span>{item}</span>
          </div>
        ))}
        {p.showTitle && <div style={{ display: 'flex', marginTop: 32, fontSize: 28, color: '#9ca3af' }}>{p.showTitle}</div>}
      </div>
    </CardFrame>
  );
}

/** 对谈卡: two speakers' lines as alternating bubbles. */
export function DialogCard({ spec, brand }: { spec: CardSpec; brand: BrandOptions }) {
  const p = spec.payload as DialogCardPayload;
  return (
    <CardFrame spec={spec} brand={brand}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
      {p.lines.map((line, i) => {
        const isLeft = i % 2 === 0;
        return (
          <div key={i} style={{ display: 'flex', justifyContent: isLeft ? 'flex-start' : 'flex-end', marginBottom: 28 }}>
            <div style={{
              maxWidth: '80%',
              background: isLeft ? '#f3f4f6' : brand.accentColor,
              color: isLeft ? '#111827' : '#ffffff',
              borderRadius: 24,
              padding: '24px 32px',
              fontSize: 34,
              lineHeight: 1.4,
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{ fontSize: 24, opacity: 0.7, marginBottom: 8 }}>{line.speaker}</div>
              {line.text}
            </div>
          </div>
        );
      })}
      </div>
    </CardFrame>
  );
}

/** Dispatch a spec to the right template. */
export function renderCardElement(spec: CardSpec, brand: BrandOptions = DEFAULT_BRAND): React.ReactNode {
  switch (spec.template) {
    case 'quote':
      return <QuoteCard spec={spec} brand={brand} />;
    case 'list':
      return <ListCard spec={spec} brand={brand} />;
    case 'dialog':
      return <DialogCard spec={spec} brand={brand} />;
    case 'cover':
      return <CoverCard spec={spec} brand={brand} />;
    default:
      return null;
  }
}

/** 封面卡 (PRD §B1 封面模板：大字标题+节目名+品牌角标). */
export function CoverCard({ spec, brand }: { spec: CardSpec; brand: BrandOptions }) {
  const p = spec.payload as unknown as CoverCardPayload;
  return (
    <CardFrame spec={spec} brand={brand}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {p.showTitle && (
          <div style={{ fontSize: 36, color: '#6b7280', letterSpacing: 2 }}>{p.showTitle}</div>
        )}
        <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.15, color: brand.accentColor }}>
          {p.title}
        </div>
        {p.episodeNumber && (
          <div style={{ fontSize: 40, color: '#9ca3af' }}>EP.{p.episodeNumber}</div>
        )}
      </div>
    </CardFrame>
  );
}
