import { describe, it, expect } from 'vitest';
import { isNamedSpeaker, normalizePersonName, linkConfidence, fuseIdentitySignals } from '@/lib/person/identity-resolver';

describe('fuseIdentitySignals (§7.1 three-signal fusion + uncertainty band)', () => {
  it('voiceprint alone maxes at w_v·1.0 = 0.45 → new band (single signal never auto-merges)', () => {
    const r = fuseIdentitySignals({ voiceCos: 1.0 });
    expect(r.score).toBeCloseTo(0.45, 2);
    expect(r.method).toBe('voiceprint');
    expect(r.band).toBe('new'); // <0.60
  });
  it('metadata + text together = 0.55 → new band (below 0.60 floor)', () => {
    const r = fuseIdentitySignals({ metaMatch: true, textMatch: true });
    expect(r.score).toBeCloseTo(0.55, 2);
    expect(r.band).toBe('new');
  });
  it('voiceprint + metadata → review band (0.60–0.85)', () => {
    // 0.45·0.7 + 0.35 = 0.665
    const r = fuseIdentitySignals({ voiceCos: 0.7, metaMatch: true });
    expect(r.score).toBeGreaterThan(0.60);
    expect(r.score).toBeLessThan(0.85);
    expect(r.band).toBe('review');
  });
  it('no signals → new entity band', () => {
    const r = fuseIdentitySignals({});
    expect(r.score).toBe(0);
    expect(r.band).toBe('new');
  });
  it('all three signals together reach auto band (≥0.85)', () => {
    // 0.45·1.0 + 0.35 + 0.20 = 1.0
    const r = fuseIdentitySignals({ voiceCos: 1.0, metaMatch: true, textMatch: true });
    expect(r.band).toBe('auto');
    expect(r.method).toBe('fused');
  });
});

describe('isNamedSpeaker (L0 anonymous detection)', () => {
  it.each(['SPEAKER_UNKNOWN', 'speaker-unidentified', 'Speaker A', 'Host', '主持人'])('rejects the shared generic placeholder %s', (name) => {
    expect(isNamedSpeaker(name)).toBe(false);
  });
  it('rejects anonymous diarization labels', () => {
    expect(isNamedSpeaker('SPEAKER_00')).toBe(false);
    expect(isNamedSpeaker('SPEAKER_01')).toBe(false);
    expect(isNamedSpeaker('speaker_0')).toBe(false);
    expect(isNamedSpeaker('SPEAKERS_00')).toBe(false);
    expect(isNamedSpeaker('unknown')).toBe(false);
    expect(isNamedSpeaker(null)).toBe(false);
    expect(isNamedSpeaker('')).toBe(false);
  });

  it('accepts real person names (incl. Chinese / punctuation)', () => {
    expect(isNamedSpeaker('Marc Andreessen')).toBe(true);
    expect(isNamedSpeaker('柯丽一鸣')).toBe(true);
    expect(isNamedSpeaker('K（克利伊明）')).toBe(true);
    expect(isNamedSpeaker('张小珺')).toBe(true);
  });
});

describe('normalizePersonName (matching key)', () => {
  it('lowercases, NFKC-normalizes, strips punctuation and whitespace', () => {
    expect(normalizePersonName('Marc Andreessen')).toBe('marcandreessen');
    expect(normalizePersonName('  K（克利伊明） ')).toBe('k克利伊明');
    expect(normalizePersonName('张 小珺')).toBe('张小珺');
  });

  it('two surface forms of the same name match', () => {
    expect(normalizePersonName('Marc Andreessen')).toBe(normalizePersonName('marc andreessen'));
  });
});

describe('linkConfidence (signal fusion)', () => {
  it('a voiceprint match dominates and can reach ~1.0', () => {
    expect(linkConfidence({ nameMatch: true, voiceprint: 1.0 })).toBeCloseTo(1.0, 5);
    expect(linkConfidence({ nameMatch: false, voiceprint: 0.9 })).toBeCloseTo(0.97, 5);
  });

  it('name + role never exceeds 0.95 (gated for human/voiceprint confirmation)', () => {
    expect(linkConfidence({ nameMatch: true, roleKnown: true })).toBeLessThanOrEqual(0.95);
    expect(linkConfidence({ nameMatch: true })).toBe(0.85);
    expect(linkConfidence({ nameMatch: true, roleKnown: false })).toBe(0.85);
  });

  it('no signals yields zero confidence', () => {
    expect(linkConfidence({ nameMatch: false })).toBe(0);
  });
});
