/**
 * DER (Diarization Error Rate) Evaluation Script
 *
 * Compares diarization output against human-labeled ground truth.
 * DER = (false alarm + missed detection + confusion) / total reference speech
 *
 * Usage:
 *   npx tsx scripts/eval-der.ts --reference <rttm> --hypothesis <rttm>
 *
 * RTTM format (per line):
 *   SPEAKER <file> 1 <start> <duration> <NA> <NA> <speaker> <NA> <NA>
 *
 * Or JSON format:
 *   { "segments": [{ "label": "SPEAKER_00", "start": 0.0, "end": 5.2 }] }
 */

import { readFileSync } from 'node:fs';

interface Segment {
  label: string;
  start: number;
  end: number;
}

function parseRttm(content: string): Segment[] {
  return content
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('SPEAKER'))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        label: parts[7],
        start: parseFloat(parts[3]),
        end: parseFloat(parts[3]) + parseFloat(parts[4]),
      };
    });
}

function parseJson(content: string): Segment[] {
  const data = JSON.parse(content) as { segments: Segment[] };
  return data.segments.map((s) => ({
    label: s.label,
    start: s.start,
    end: s.end,
  }));
}

function loadSegments(filePath: string): Segment[] {
  const content = readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.rttm')) return parseRttm(content);
  return parseJson(content);
}

/**
 * Build a mapping from reference labels to hypothesis labels using
 * optimal alignment (greedy by maximum overlap).
 */
function alignSpeakers(ref: Segment[], hyp: Segment[]): Map<string, string> {
  const refLabels = [...new Set(ref.map((s) => s.label))];
  const hypLabels = [...new Set(hyp.map((s) => s.label))];

  // Calculate overlap matrix
  const overlap = new Map<string, number>();
  for (const r of refLabels) {
    for (const h of hypLabels) {
      let totalOverlap = 0;
      for (const refSeg of ref.filter((s) => s.label === r)) {
        for (const hypSeg of hyp.filter((s) => s.label === h)) {
          const overlapStart = Math.max(refSeg.start, hypSeg.start);
          const overlapEnd = Math.min(refSeg.end, hypSeg.end);
          totalOverlap += Math.max(0, overlapEnd - overlapStart);
        }
      }
      overlap.set(`${r}:${h}`, totalOverlap);
    }
  }

  // Greedy alignment: pick the pair with most overlap, remove both, repeat
  const mapping = new Map<string, string>();
  const remainingRef = new Set(refLabels);
  const remainingHyp = new Set(hypLabels);

  while (remainingRef.size > 0 && remainingHyp.size > 0) {
    let bestPair: { r: string; h: string; overlap: number } | null = null;
    for (const r of remainingRef) {
      for (const h of remainingHyp) {
        const o = overlap.get(`${r}:${h}`) || 0;
        if (!bestPair || o > bestPair.overlap) {
          bestPair = { r, h, overlap: o };
        }
      }
    }
    if (bestPair && bestPair.overlap > 0) {
      mapping.set(bestPair.r, bestPair.h);
      remainingRef.delete(bestPair.r);
      remainingHyp.delete(bestPair.h);
    } else {
      break;
    }
  }

  return mapping;
}

function computeDER(ref: Segment[], hyp: Segment[]): {
  der: number;
  falseAlarm: number;
  missedDetection: number;
  confusion: number;
  totalRef: number;
} {
  // Total reference speech duration
  const totalRef = ref.reduce((sum, s) => sum + (s.end - s.start), 0);

  // Align speakers
  const mapping = alignSpeakers(ref, hyp);

  // Time step for frame-based comparison (10ms)
  const step = 0.01;
  const maxEnd = Math.max(
    ...ref.map((s) => s.end),
    ...hyp.map((s) => s.end),
  );

  let falseAlarm = 0;
  let missedDetection = 0;
  let confusion = 0;
  let scored = 0;

  for (let t = 0; t < maxEnd; t += step) {
    // Find ref and hyp speakers active at time t
    const refSpeakers = new Set(
      ref.filter((s) => t >= s.start && t < s.end).map((s) => s.label),
    );
    const hypSpeakers = new Set(
      hyp.filter((s) => t >= s.start && t < s.end).map((s) => s.label),
    );

    // Map ref speakers to hyp space
    const mappedRef = new Set(
      [...refSpeakers].map((r) => mapping.get(r) || r),
    );

    if (refSpeakers.size > 0) {
      scored += step;
    }

    // False alarm: hyp speaks but ref doesn't
    for (const h of hypSpeakers) {
      if (!mappedRef.has(h) && refSpeakers.size > 0) {
        falseAlarm += step;
      }
    }

    // Missed detection: ref speaks but hyp doesn't
    for (const r of mappedRef) {
      if (!hypSpeakers.has(r)) {
        missedDetection += step;
      }
    }

    // Confusion: both speak but different speakers
    if (refSpeakers.size > 0 && hypSpeakers.size > 0) {
      const refSet = mappedRef;
      const hypSet = hypSpeakers;
      const intersection = [...refSet].filter((x) => hypSet.has(x));
      if (intersection.length === 0) {
        confusion += step;
      }
    }
  }

  const der = scored > 0 ? (falseAlarm + missedDetection + confusion) / scored : 0;

  return {
    der,
    falseAlarm,
    missedDetection,
    confusion,
    totalRef,
  };
}

// CLI
const args = process.argv.slice(2);
const refIdx = args.indexOf('--reference');
const hypIdx = args.indexOf('--hypothesis');

if (refIdx === -1 || hypIdx === -1 || !args[refIdx + 1] || !args[hypIdx + 1]) {
  console.error('Usage: npx tsx scripts/eval-der.ts --reference <file> --hypothesis <file>');
  process.exit(1);
}

const ref = loadSegments(args[refIdx + 1]);
const hyp = loadSegments(args[hypIdx + 1]);

console.log(`Reference: ${ref.length} segments, ${new Set(ref.map((s) => s.label)).size} speakers`);
console.log(`Hypothesis: ${hyp.length} segments, ${new Set(hyp.map((s) => s.label)).size} speakers`);

const result = computeDER(ref, hyp);

console.log('\n--- DER Results ---');
console.log(`DER:               ${(result.der * 100).toFixed(2)}%`);
console.log(`False Alarm:       ${(result.falseAlarm).toFixed(2)}s`);
console.log(`Missed Detection:  ${(result.missedDetection).toFixed(2)}s`);
console.log(`Confusion:         ${(result.confusion).toFixed(2)}s`);
console.log(`Total Ref Speech:  ${(result.totalRef).toFixed(2)}s`);
