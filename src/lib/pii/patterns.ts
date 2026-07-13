/**
 * PII Detection Patterns
 *
 * Regex patterns for common PII entity types.
 * Used by the M0 regex-based PII redactor.
 * These are intentionally conservative — high precision over recall
 * to minimise false positives in transcribed speech.
 */

import { PiiEntityType } from './types';

export interface PiiPattern {
  entityType: PiiEntityType;
  pattern: RegExp;
  description: string;
  /** Minimum confidence for matches from this pattern (0-1) */
  confidence: number;
}

/**
 * Ordered list of PII detection patterns.
 * Order matters: more specific patterns should come first to avoid
 * partial matches being consumed by more general patterns.
 */
export const PII_PATTERNS: PiiPattern[] = [
  // ── High confidence patterns ──

  {
    entityType: PiiEntityType.EMAIL,
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    description: 'Email addresses',
    confidence: 0.95,
  },
  {
    entityType: PiiEntityType.URL,
    pattern: /https?:\/\/[a-zA-Z0-9.-]+(?:\/[^\s)]*)?/g,
    description: 'URLs (http/https)',
    confidence: 0.95,
  },
  {
    entityType: PiiEntityType.CREDIT_CARD,
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    description: 'Credit card numbers (basic Luhn-checkable pattern)',
    confidence: 0.9,
  },
  {
    entityType: PiiEntityType.SSN,
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    description: 'US Social Security numbers',
    confidence: 0.95,
  },
  {
    entityType: PiiEntityType.CRYPTO_WALLET,
    pattern: /\b(?:0x[a-fA-F0-9]{40}|1[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,39})\b/g,
    description: 'Crypto wallet addresses (ETH/BTC)',
    confidence: 0.9,
  },
  {
    entityType: PiiEntityType.API_KEY,
    pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xox[bpras]-[a-zA-Z0-9]{10,})\b/g,
    description: 'API keys (OpenAI, GitHub, Slack patterns)',
    confidence: 0.95,
  },

  // ── Medium confidence patterns ──

  {
    entityType: PiiEntityType.PHONE,
    // Matches US/CA phone numbers with optional country code
    pattern: /\b(?:\+?1[-\s.]?)?\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4}\b/g,
    description: 'Phone numbers (US/CA format)',
    confidence: 0.85,
  },
  {
    entityType: PiiEntityType.IP_ADDRESS,
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    description: 'IPv4 addresses',
    confidence: 0.8,
  },
  {
    entityType: PiiEntityType.DATE_OF_BIRTH,
    pattern: /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    description: 'Date-like patterns (potential DOB)',
    confidence: 0.6,
  },

  // ── Lower confidence patterns (speech context) ──

  {
    entityType: PiiEntityType.LOCATION,
    // Common location patterns in transcribed speech
    pattern: /\b(?:in|at|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    description: 'Potential location references (in/at/near + capitalized word)',
    confidence: 0.4,
  },
];

/**
 * Get patterns for a specific set of entity types.
 * If enabledTypes is undefined, returns all patterns.
 */
export function getPatternsForTypes(enabledTypes?: PiiEntityType[]): PiiPattern[] {
  if (!enabledTypes || enabledTypes.length === 0) {
    return PII_PATTERNS;
  }
  return PII_PATTERNS.filter((p) => enabledTypes.includes(p.entityType));
}
