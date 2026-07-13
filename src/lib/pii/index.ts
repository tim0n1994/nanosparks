/**
 * PII Redaction — Public API
 *
 * Usage:
 *   import { redactPii, createPiiRedactor } from '@/lib/pii';
 *
 *   const result = await redactPii('My email is user@example.com');
 *   // result.redactedText === 'My email is [REDACTED_EMAIL]'
 */

export { PiiEntityType, DEFAULT_REPLACEMENT_TEMPLATE } from './types';
export type {
  PiiEntity,
  PiiAnalysisResult,
  PiiRedactionResult,
  PiiRedactorConfig,
  PiiRedactor,
} from './types';
export { RegexPiiRedactor } from './redactor';
export { PII_PATTERNS } from './patterns';

import type { PiiRedactor, PiiRedactorConfig, PiiRedactionResult } from './types';
import { RegexPiiRedactor } from './redactor';

/**
 * Default redactor instance (singleton).
 * Stateless, so safe to reuse across requests.
 */
let defaultRedactor: PiiRedactor | null = null;

function getRedactor(): PiiRedactor {
  if (!defaultRedactor) {
    defaultRedactor = new RegexPiiRedactor();
    // M1: check env for PRESIDIO_URL and create PresidioPiiRedactor instead
  }
  return defaultRedactor;
}

/**
 * Quick redact a string of text.
 * Uses the default redactor (M0: regex, M1: Presidio).
 */
export async function redactPii(
  text: string,
  config?: PiiRedactorConfig,
): Promise<PiiRedactionResult> {
  return getRedactor().redact(text, config);
}

/**
 * Create a standalone PII redactor instance.
 * Use this for custom configuration.
 */
export function createPiiRedactor(): PiiRedactor {
  return new RegexPiiRedactor();
}

/**
 * Redact an array of text segments in batch.
 */
export async function redactPiiBatch(
  segments: Array<{ text: string }>,
  config?: PiiRedactorConfig,
): Promise<Array<{ text: string; redactedText: string }>> {
  const redactor = getRedactor();
  const results = await Promise.all(
    segments.map((seg) => redactor.redact(seg.text, config)),
  );
  return segments.map((seg, i) => ({
    text: seg.text,
    redactedText: results[i].redactedText,
  }));
}
