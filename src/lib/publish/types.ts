/**
 * Shared types for the publish/content-pack layer (B1/C2).
 */

/** A minimal thought-unit view passed to copy + card generators. */
export interface ThoughtUnitLike {
  id: string;
  text: string;
  /** Optional attribution (speaker name) for quote cards. */
  speaker?: string;
  /** Optional timestamp ms for card footers. */
  startMs?: number;
}

/** Card templates (PRD §B1): 金句 / 清单 / 对谈. */
// 金句 / 清单 / 对谈 / 封面 (PRD §B1).
export type CardTemplate = 'quote' | 'list' | 'dialog' | 'cover';

/** A rendered card artifact before it is rasterized to PNG. */
export interface CardSpec {
  template: CardTemplate;
  /** 1242x1656 (3:4) per PRD §B1. */
  width: number;
  height: number;
  /** Payload depends on template (see card builders). */
  payload: CardPayload;
}

export interface QuoteCardPayload {
  quote: string;
  speaker?: string;
  showTitle?: string;
  timestampLabel?: string;
}

export interface ListCardPayload {
  title: string;
  items: string[];
  showTitle?: string;
}

export interface DialogCardPayload {
  lines: Array<{ speaker: string; text: string }>;
  showTitle?: string;
}

export interface CoverCardPayload {
  title: string;
  showTitle?: string;
  episodeNumber?: string;
}

export type CardPayload = QuoteCardPayload | ListCardPayload | DialogCardPayload | CoverCardPayload;

/** Rendered PNG result with its storage key + AIGC implicit-label metadata. */
export interface RenderedCard {
  template: CardTemplate;
  pngBuffer: Buffer;
  storageKey: string;
  width: number;
  height: number;
  /** XMP/implicit AIGC label written into the PNG metadata (PRD §标识办法). */
  aigcLabel: AigcLabel;
}

/** Implicit AIGC label written into exported file metadata (PRD §8/§B1). */
export interface AigcLabel {
  providerCode: string;
  contentId: string;
  generatedAt: string;
}
