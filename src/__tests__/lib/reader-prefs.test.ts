import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFS,
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  clampFontScale,
  clampLineHeight,
} from '@/lib/reader-prefs';

describe('reader-prefs', () => {
  it('defaults to neutral font scale, 1.6 line height, light mode', () => {
    expect(DEFAULT_PREFS.fontScale).toBe(1);
    expect(DEFAULT_PREFS.lineHeight).toBe(1.6);
    expect(DEFAULT_PREFS.darkMode).toBe(false);
  });

  it('exposes the allowed font scale and line height options', () => {
    expect(FONT_SCALE_OPTIONS).toContain(1);
    expect(FONT_SCALE_OPTIONS.length).toBeGreaterThan(1);
    expect(LINE_HEIGHT_OPTIONS).toContain(1.6);
  });
});

describe('clampFontScale', () => {
  it('keeps allowed values', () => {
    expect(clampFontScale(0.9)).toBe(0.9);
    expect(clampFontScale(1.25)).toBe(1.25);
  });

  it('falls back to 1 for disallowed values', () => {
    expect(clampFontScale(0.5)).toBe(1);
    expect(clampFontScale(99)).toBe(1);
    expect(clampFontScale(NaN)).toBe(1);
  });
});

describe('clampLineHeight', () => {
  it('keeps allowed values', () => {
    expect(clampLineHeight(1.8)).toBe(1.8);
  });

  it('falls back to 1.6 for disallowed values', () => {
    expect(clampLineHeight(3)).toBe(1.6);
    expect(clampLineHeight(NaN)).toBe(1.6);
  });
});
