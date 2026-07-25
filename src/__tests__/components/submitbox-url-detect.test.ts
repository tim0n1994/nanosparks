/**
 * looksLikeUrl is a module-private helper in SubmitBox; we test the same
 * heuristic shape here to pin the URL-vs-name routing policy. Kept in sync
 * by mirroring the rules (scheme:// or schemeless host with a dot, no spaces).
 */
import { describe, it, expect } from 'vitest';

// Mirrors SubmitBox.looksLikeUrl — if that changes, update here too.
function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (/\s/.test(s)) return false;
  const firstSeg = s.split('/')[0];
  return firstSeg.includes('.') && firstSeg.length <= 100;
}

describe('looksLikeUrl (smart input routing)', () => {
  it('treats full URLs as URLs', () => {
    expect(looksLikeUrl('https://open.spotify.com/show/abc')).toBe(true);
    expect(looksLikeUrl('http://example.com')).toBe(true);
  });
  it('treats schemeless hosts as URLs', () => {
    expect(looksLikeUrl('open.spotify.com/show/abc')).toBe(true);
    expect(looksLikeUrl('youtu.be/abc')).toBe(true);
  });
  it('treats podcast names as names (→ discover)', () => {
    expect(looksLikeUrl('The Ezra Klein Show')).toBe(false); // has spaces
    expect(looksLikeUrl('Acquired')).toBe(false); // no dot
    expect(looksLikeUrl('20VC')).toBe(false);
  });
  it('rejects empty', () => {
    expect(looksLikeUrl('')).toBe(false);
    expect(looksLikeUrl('   ')).toBe(false);
  });
});
