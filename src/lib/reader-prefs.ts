/**
 * Reader display preferences (PRD §A3 移动端优先：字号/行距设置、暗色).
 *
 * Font scale, line height, and dark mode are per-user reader preferences
 * persisted to localStorage (no DB round-trip needed for a display setting).
 * The reader shell applies them as inline styles on the transcript body so the
 * controls work offline-first and stay snappy on mobile.
 */

export interface ReaderPrefs {
  fontScale: number; // 1.0 = default; 0.9 small, 1.1 large
  lineHeight: number; // 1.6 default
  darkMode: boolean;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  fontScale: 1,
  lineHeight: 1.6,
  darkMode: false,
};

export const FONT_SCALE_OPTIONS = [0.9, 1, 1.1, 1.25];
export const LINE_HEIGHT_OPTIONS = [1.5, 1.6, 1.8, 2];

const STORAGE_KEY = 'nanosparks:readerPrefs';

/** Clamp a font scale to the allowed options (defensive against bad stored values). */
export function clampFontScale(v: number): number {
  return FONT_SCALE_OPTIONS.includes(v) ? v : 1;
}

/** Clamp a line height to the allowed options. */
export function clampLineHeight(v: number): number {
  return LINE_HEIGHT_OPTIONS.includes(v) ? v : 1.6;
}

/** Merge stored prefs with defaults + clamp (SSR-safe: returns defaults if no window). */
export function loadPrefs(): ReaderPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      fontScale: clampFontScale(Number(parsed.fontScale ?? 1)),
      lineHeight: clampLineHeight(Number(parsed.lineHeight ?? 1.6)),
      darkMode: Boolean(parsed.darkMode),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persist prefs to localStorage. No-op on the server. */
export function savePrefs(prefs: ReaderPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage may be unavailable (private mode); ignore */
  }
}

/** The base body font size (px) the scale multiplies. */
export const BASE_BODY_FONT_PX = 15;
