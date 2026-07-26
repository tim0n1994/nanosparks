import { describe, it, expect } from 'vitest';
import { assignTurnsToNamedSpeakers } from '@/lib/person/merge-speakers';

const speakers = [
  { id: 'p_marc', name: 'Marc Andreessen' },
  { id: 'p_swyx', name: 'Swyx' },
];

describe('assignTurnsToNamedSpeakers (pure parser)', () => {
  it('maps valid assignments to participant ids', () => {
    const raw = JSON.stringify([
      { turnIndex: 0, speakerId: 'p_marc' },
      { turnIndex: 1, speakerId: 'p_swyx' },
      { turnIndex: 2, speakerId: 'p_marc' },
    ]);
    const m = assignTurnsToNamedSpeakers(raw, speakers);
    expect(m.get(0)).toBe('p_marc');
    expect(m.get(1)).toBe('p_swyx');
    expect(m.get(2)).toBe('p_marc');
    expect(m.size).toBe(3);
  });

  it('drops assignments to unknown speaker ids', () => {
    const raw = JSON.stringify([
      { turnIndex: 0, speakerId: 'p_marc' },
      { turnIndex: 1, speakerId: 'SPEAKER_00' }, // not a named speaker id
      { turnIndex: 2, speakerId: 'bogus' },
    ]);
    const m = assignTurnsToNamedSpeakers(raw, speakers);
    expect(m.size).toBe(1);
    expect(m.get(0)).toBe('p_marc');
  });

  it('tolerates markdown fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"turnIndex":0,"speakerId":"p_swyx"}]\n```';
    const m = assignTurnsToNamedSpeakers(raw, speakers);
    expect(m.get(0)).toBe('p_swyx');
  });

  it('returns empty map for unparseable input', () => {
    expect(assignTurnsToNamedSpeakers('not json at all', speakers).size).toBe(0);
    expect(assignTurnsToNamedSpeakers('[]', speakers).size).toBe(0);
  });
});
