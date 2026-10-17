export interface EvidenceCoordinateTurn {
  turnIndex: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface EvidenceCoordinateCandidate {
  quote?: string | null;
  turnIndex?: number;
  startMs?: number;
  endMs?: number;
}

export interface VerifiedEvidenceSpan {
  quote: string;
  turnIndex: number;
  startMs: number;
  endMs: number;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD = /[\p{L}\p{N}]/u;

function normalizedText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[\p{P}\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]) (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, '')
    .trim();
}

function substantialQuote(text: string): boolean {
  const characters = [...text].filter((character) => WORD.test(character));
  const cjkCount = characters.filter((character) => CJK.test(character)).length;
  return cjkCount >= 4 || (characters.length >= 12 && text.split(' ').length >= 3);
}

function splitsWord(text: string, offset: number): boolean {
  const before = [...text.slice(Math.max(0, offset - 2), offset)].at(-1);
  const after = [...text.slice(offset, offset + 2)][0];
  return Boolean(before && after && WORD.test(before) && WORD.test(after)
    && !CJK.test(before) && !CJK.test(after));
}

export function normalizeEvidenceSpans(
  spans: readonly EvidenceCoordinateCandidate[] | undefined,
  turns: readonly EvidenceCoordinateTurn[],
): VerifiedEvidenceSpan[] {
  if (!spans?.length || !turns.length) return [];
  return createEvidenceCoordinateResolver(turns)(spans);
}

export function createEvidenceCoordinateResolver(
  turns: readonly EvidenceCoordinateTurn[],
): (spans: readonly EvidenceCoordinateCandidate[] | undefined) => VerifiedEvidenceSpan[] {
  const counts = new Map<number, number>();
  for (const turn of turns) counts.set(turn.turnIndex, (counts.get(turn.turnIndex) ?? 0) + 1);
  const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
  const ranges: { start: number; end: number; turn: EvidenceCoordinateTurn }[] = [];
  const chunks: string[] = [];
  let length = 0;
  let previous: EvidenceCoordinateTurn | undefined;
  let lastCharacter = '';

  for (const turn of ordered) {
    const valid = Number.isSafeInteger(turn.turnIndex) && turn.turnIndex >= 0
      && counts.get(turn.turnIndex) === 1
      && Number.isSafeInteger(turn.startMs) && Number.isSafeInteger(turn.endMs)
      && turn.startMs >= 0 && turn.endMs >= turn.startMs && turn.endMs <= 2_147_483_647;
    const text = valid ? normalizedText(turn.text) : '';
    if (!text) {
      previous = undefined;
      continue;
    }
    const separator = previous && turn.turnIndex === previous.turnIndex + 1
      && turn.startMs >= previous.startMs && turn.endMs >= previous.endMs
      ? (CJK.test(lastCharacter) && CJK.test([...text][0]) ? '' : ' ')
      : '\0';
    chunks.push(separator, text);
    length += separator.length;
    ranges.push({ start: length, end: length + text.length, turn: { ...turn } });
    length += text.length;
    lastCharacter = [...text].at(-1) ?? '';
    previous = turn;
  }

  const source = chunks.join('');
  function containingRange(offset: number) {
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const range = ranges[middle];
      if (offset < range.start) high = middle - 1;
      else if (offset >= range.end) low = middle + 1;
      else return range;
    }
    return undefined;
  }

  const resolved = new Map<string, Omit<VerifiedEvidenceSpan, 'quote'> | null>();
  return (spans) => {
    const result: VerifiedEvidenceSpan[] = [];
    for (const span of spans ?? []) {
      if (typeof span.quote !== 'string' || span.quote.length > 16_000) continue;
      const quote = normalizedText(span.quote);
      if (!substantialQuote(quote)) continue;
      if (!resolved.has(quote)) {
        let match = -1;
        let ambiguous = false;
        let offset = source.indexOf(quote);
        while (offset !== -1) {
          if (!splitsWord(source, offset) && !splitsWord(source, offset + quote.length)) {
            if (match !== -1) {
              ambiguous = true;
              break;
            }
            match = offset;
          }
          offset = source.indexOf(quote, offset + 1);
        }
        const first = match === -1 ? undefined : containingRange(match);
        const last = match === -1 ? undefined : containingRange(match + quote.length - 1);
        resolved.set(quote, !ambiguous && first && last && last.turn.endMs >= first.turn.startMs
          ? { turnIndex: first.turn.turnIndex, startMs: first.turn.startMs, endMs: last.turn.endMs }
          : null);
      }
      const coordinates = resolved.get(quote);
      if (coordinates) result.push({ ...coordinates, quote: span.quote.trim() });
    }
    return result;
  };
}
