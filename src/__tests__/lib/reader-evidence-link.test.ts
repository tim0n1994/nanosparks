import { describe, it, expect } from 'vitest';
import { readerEvidenceLink, parseReaderAnchor } from '@/lib/reader/evidence-link';

describe('reader evidence links', () => {
  it('does not fabricate an anchor when evidence is absent or invalid', () => {
    expect(readerEvidenceLink('conv')).toBe('/read/conv');
    expect(readerEvidenceLink('conv', { startMs: -1 })).toBe('/read/conv');
    expect(readerEvidenceLink('conv', { startMs: NaN })).toBe('/read/conv');
  });
  it('preserves time zero and URL-encodes identifiers', () => {
    expect(readerEvidenceLink('conv/id', { turnId: 'turn&id', startMs: 0 })).toBe('/read/conv%2Fid?turn=turn%26id&t=0');
  });
  it('accepts exact IDs or valid milliseconds but rejects invalid time anchors', () => {
    expect(parseReaderAnchor(new URLSearchParams('t=0'))).toEqual({ turnId: null, startMs: 0 });
    expect(parseReaderAnchor(new URLSearchParams('turn=t42&t=42000'))).toEqual({ turnId: 't42', startMs: 42000 });
    for (const query of ['', 't=-1', 't=Infinity', 't=2.5', 't=']) expect(parseReaderAnchor(new URLSearchParams(query))).toBeNull();
  });
});
