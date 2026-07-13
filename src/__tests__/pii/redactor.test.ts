/**
 * Tests for RegexPiiRedactor and the PII public API.
 *
 * Covers:
 * - All 10 entity type detection patterns
 * - Redaction with placeholder replacement
 * - Configuration (enabledTypes, minConfidence, replacementTemplate, customPatterns)
 * - Edge cases (empty text, no PII, overlapping entities)
 * - Public API (redactPii, redactPiiBatch, createPiiRedactor)
 */

import { describe, it, expect } from 'vitest';
import {
  RegexPiiRedactor,
  PiiEntityType,
  PiiRedactorConfig,
  createPiiRedactor,
  redactPii,
  redactPiiBatch,
} from '@/lib/pii';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const redactor = new RegexPiiRedactor();

// ---------------------------------------------------------------------------
// analyze — entity detection
// ---------------------------------------------------------------------------

describe('RegexPiiRedactor.analyze', () => {
  describe('EMAIL', () => {
    // Regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    it('detects simple email', async () => {
      const result = await redactor.analyze('Contact me at john.doe@example.com');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject({
        entityType: PiiEntityType.EMAIL,
        text: 'john.doe@example.com',
        confidence: 0.95,
      });
    });

    it('detects email with + alias', async () => {
      const result = await redactor.analyze('Email: user+tag@company.co.uk');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].text).toBe('user+tag@company.co.uk');
    });

    it('does not detect bare words as email', async () => {
      const result = await redactor.analyze('This is just a normal sentence with no email.');
      expect(result.entities.filter((e) => e.entityType === PiiEntityType.EMAIL)).toHaveLength(0);
    });
  });

  describe('URL', () => {
    // Regex: /https?:\/\/[a-zA-Z0-9.-]+(?:\/[^\s)]*)?/g
    it('detects https URL', async () => {
      const result = await redactor.analyze('Visit https://example.com/page for details');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.URL,
          text: 'https://example.com/page',
          confidence: 0.95,
        }),
      );
    });

    it('detects http URL with path', async () => {
      const result = await redactor.analyze('See http://docs.example.org/api/v1');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.URL,
          text: 'http://docs.example.org/api/v1',
        }),
      );
    });

    it('does not mark plain words as URLs', async () => {
      const result = await redactor.analyze('This example.com is not https://');
      expect(result.entities.filter((e) => e.entityType === PiiEntityType.URL)).toHaveLength(0);
    });
  });

  describe('CREDIT_CARD', () => {
    // Regex: /\b(?:\d{4}[\-\s]?){3}\d{4}\b/g
    it('detects credit card with spaces', async () => {
      const result = await redactor.analyze('Card: 4111 1111 1111 1111');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.CREDIT_CARD,
          text: '4111 1111 1111 1111',
          confidence: 0.9,
        }),
      );
    });

    it('detects credit card with dashes', async () => {
      const result = await redactor.analyze('Card: 4111-1111-1111-1111');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.CREDIT_CARD,
          text: '4111-1111-1111-1111',
        }),
      );
    });

    it('detects credit card without separators', async () => {
      const result = await redactor.analyze('Card: 4111111111111111');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.CREDIT_CARD,
          text: '4111111111111111',
        }),
      );
    });

    it('does not detect short number sequences', async () => {
      const result = await redactor.analyze('The code is 123456');
      expect(result.entities.filter((e) => e.entityType === PiiEntityType.CREDIT_CARD)).toHaveLength(0);
    });
  });

  describe('SSN', () => {
    // Regex: /\b\d{3}-\d{2}-\d{4}\b/g
    it('detects SSN', async () => {
      const result = await redactor.analyze('My SSN is 123-45-6789');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.SSN,
          text: '123-45-6789',
          confidence: 0.95,
        }),
      );
    });

    it('detects SSN at end of sentence', async () => {
      const result = await redactor.analyze('ID: 987-65-4321.');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.SSN,
          text: '987-65-4321',
        }),
      );
    });

    it('matches SSN pattern even in prose context (regex limitation)', async () => {
      // "Pages 123-45-6789" contains a valid SSN pattern, so it matches.
      // This is a false positive — acceptable for M0 regex.
      const result = await redactor.analyze('Pages 123-45-6789 refer to the document');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.SSN,
          text: '123-45-6789',
        }),
      );
    });
  });

  describe('CRYPTO_WALLET', () => {
    // Regex: /\b(?:0x[a-fA-F0-9]{40}|1[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,39})\b/g
    it('detects Ethereum address', async () => {
      const addr = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';
      const result = await redactor.analyze(`Wallet: ${addr}`);
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.CRYPTO_WALLET,
          text: addr,
          confidence: 0.9,
        }),
      );
    });

    it('detects Bitcoin address', async () => {
      const addr = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
      const result = await redactor.analyze(`BTC: ${addr}`);
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.CRYPTO_WALLET,
          text: addr,
        }),
      );
    });

    it('detects bech32 Bitcoin address', async () => {
      const addr = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
      const result = await redactor.analyze(`BTC: ${addr}`);
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.CRYPTO_WALLET,
          text: addr,
        }),
      );
    });
  });

  describe('API_KEY', () => {
    // Regex: /\b(?:sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xox[bpras]-[a-zA-Z0-9]{10,})\b/g
    // Note: OpenAI keys with 'sk-proj-' won't match because '-' breaks [a-zA-Z0-9].
    // The regex expects 20+ alphanumeric chars directly after 'sk-'.
    it('detects OpenAI-style API key', async () => {
      const result = await redactor.analyze('Key: sk-ABC123def456GHI789jkl012mnop345');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.API_KEY,
          text: 'sk-ABC123def456GHI789jkl012mnop345',
          confidence: 0.95,
        }),
      );
    });

    it('detects GitHub personal access token', async () => {
      // ghp_ must be followed by exactly 36 alphanumeric chars
      const token = 'ghp_' + 'a'.repeat(36);
      const result = await redactor.analyze(`Token: ${token}`);
      expect(result.entities).toContainEqual(
        expect.objectContaining({ entityType: PiiEntityType.API_KEY, text: token }),
      );
    });

    it('detects Slack bot token', async () => {
      const result = await redactor.analyze('Token: xoxb-1234567890-1234567890-abcdef123456');
      expect(result.entities).toContainEqual(
        expect.objectContaining({ entityType: PiiEntityType.API_KEY }),
      );
    });
  });

  describe('PHONE', () => {
    // Regex: /\b(?:\+?1[\-\s.]?)?\(?\d{3}\)?[\-\s.]?\d{3}[\-\s.]?\d{4}\b/g
    it('detects US phone with dashes', async () => {
      const result = await redactor.analyze('Call 555-123-4567');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.PHONE,
          text: '555-123-4567',
          confidence: 0.85,
        }),
      );
    });

    it('detects US phone with parens (opening paren excluded by \\b boundary)', async () => {
      // \b before (?:\+?1...)? doesn't match because '(' is non-word,
      // so the match starts at '555'
      const result = await redactor.analyze('Call (555) 123-4567');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.PHONE,
          text: '555) 123-4567',
        }),
      );
    });

    it('detects US phone with country code (+1 excluded by \\b boundary)', async () => {
      // Same boundary issue: '+' is non-word so match starts at '1'
      const result = await redactor.analyze('Call +1-555-123-4567');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.PHONE,
          text: '1-555-123-4567',
        }),
      );
    });

    it('detects phone with dots', async () => {
      const result = await redactor.analyze('Call 555.123.4567');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.PHONE,
          text: '555.123.4567',
        }),
      );
    });
  });

  describe('IP_ADDRESS', () => {
    // Regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
    it('detects IPv4 address', async () => {
      const result = await redactor.analyze('Server at 192.168.1.1');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.IP_ADDRESS,
          text: '192.168.1.1',
          confidence: 0.8,
        }),
      );
    });

    it('detects localhost IP', async () => {
      const result = await redactor.analyze('localhost resolves to 127.0.0.1');
      expect(result.entities).toContainEqual(
        expect.objectContaining({ entityType: PiiEntityType.IP_ADDRESS }),
      );
    });

    it('accepts out-of-range octets (regex limitation)', async () => {
      // Regex doesn't validate octet ranges (0-255), so 999.999.999.999 still matches
      const result = await redactor.analyze('Version 999.999.999.999 is invalid');
      expect(result.entities.filter((e) => e.entityType === PiiEntityType.IP_ADDRESS)).toHaveLength(1);
    });
  });

  describe('DATE_OF_BIRTH', () => {
    // Regex: /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g
    it('detects DOB with slashes', async () => {
      const result = await redactor.analyze('Born 01/15/1990');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.DATE_OF_BIRTH,
          text: '01/15/1990',
          confidence: 0.6,
        }),
      );
    });

    it('detects DOB with dashes', async () => {
      const result = await redactor.analyze('Birth date: 12-25-1985');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.DATE_OF_BIRTH,
          text: '12-25-1985',
        }),
      );
    });

    it('detects short year DOB', async () => {
      const result = await redactor.analyze('DOB: 3/5/92');
      expect(result.entities).toContainEqual(
        expect.objectContaining({ entityType: PiiEntityType.DATE_OF_BIRTH }),
      );
    });
  });

  describe('LOCATION', () => {
    // Regex: /\b(?:in|at|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g
    it('detects potential location with "in"', async () => {
      const result = await redactor.analyze('He lives in Berlin');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.LOCATION,
          text: 'in Berlin',
          confidence: 0.4,
        }),
      );
    });

    it('detects potential location with "at"', async () => {
      const result = await redactor.analyze('The meeting is at Santiago');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.LOCATION,
          text: 'at Santiago',
        }),
      );
    });

    it('detects potential two-word location', async () => {
      const result = await redactor.analyze('She is in New York');
      expect(result.entities).toContainEqual(
        expect.objectContaining({
          entityType: PiiEntityType.LOCATION,
          text: 'in New York',
        }),
      );
    });

    it('does not match lowercase after preposition', async () => {
      // The pattern requires capitalized word after in/at/near
      const result = await redactor.analyze('He is in the room');
      expect(result.entities.filter((e) => e.entityType === PiiEntityType.LOCATION)).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// redact — replacement behavior
// ---------------------------------------------------------------------------

describe('RegexPiiRedactor.redact', () => {
  it('replaces email with [REDACTED_EMAIL]', async () => {
    const result = await redactor.redact('Email: user@example.com');
    expect(result.redactedText).toBe('Email: [REDACTED_EMAIL]');
    expect(result.replacementMap).toEqual({ EMAIL: '[REDACTED_EMAIL]' });
  });

  it('replaces SSN with [REDACTED_SSN]', async () => {
    const result = await redactor.redact('SSN: 123-45-6789');
    expect(result.redactedText).toBe('SSN: [REDACTED_SSN]');
  });

  it('replaces credit card with [REDACTED_CREDIT_CARD]', async () => {
    const result = await redactor.redact('Card: 4111 1111 1111 1111');
    expect(result.redactedText).toBe('Card: [REDACTED_CREDIT_CARD]');
  });

  it('replaces multiple different entity types in one string', async () => {
    const result = await redactor.redact(
      'Contact: user@example.com, phone: 555-123-4567, card: 4111 1111 1111 1111',
    );
    expect(result.redactedText).toBe(
      'Contact: [REDACTED_EMAIL], phone: [REDACTED_PHONE], card: [REDACTED_CREDIT_CARD]',
    );
    expect(result.entities).toHaveLength(3);
    expect(Object.keys(result.replacementMap).sort()).toEqual([
      'CREDIT_CARD',
      'EMAIL',
      'PHONE',
    ]);
  });

  it('replaces multiple same-type entities', async () => {
    const result = await redactor.redact('Emails: a@a.com and b@b.com');
    expect(result.redactedText).toBe('Emails: [REDACTED_EMAIL] and [REDACTED_EMAIL]');
    expect(result.entities).toHaveLength(2);
  });

  it('returns original text when no PII found', async () => {
    const result = await redactor.redact('This is a clean sentence with no PII.');
    expect(result.redactedText).toBe('This is a clean sentence with no PII.');
    expect(result.entities).toHaveLength(0);
    expect(result.replacementMap).toEqual({});
  });

  it('handles empty string', async () => {
    const result = await redactor.redact('');
    expect(result.redactedText).toBe('');
    expect(result.entities).toHaveLength(0);
  });

  it('preserves non-PII text around redactions', async () => {
    const result = await redactor.redact('Hi, my email is alice@corp.com and I live in Tokyo.');
    expect(result.redactedText).toContain('Hi, my email is');
    expect(result.redactedText).toContain('and I live');
    expect(result.redactedText).toContain('[REDACTED_EMAIL]');
  });
});

// ---------------------------------------------------------------------------
// Configuration options
// ---------------------------------------------------------------------------

describe('RegexPiiRedactor — configuration', () => {
  it('respects enabledTypes to limit detection', async () => {
    const result = await redactor.redact(
      'Email: user@test.com, Phone: 555-123-4567',
      { enabledTypes: [PiiEntityType.EMAIL] },
    );
    // Only EMAIL should be redacted, PHONE remains
    expect(result.redactedText).toContain('[REDACTED_EMAIL]');
    expect(result.redactedText).toContain('555-123-4567');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entityType).toBe(PiiEntityType.EMAIL);
  });

  it('respects minConfidence to filter low-confidence matches', async () => {
    // LOCATION has confidence 0.4, PHONE has 0.85
    const result = await redactor.redact(
      'in Berlin, call 555-123-4567',
      { minConfidence: 0.7 },
    );
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].entityType).toBe(PiiEntityType.PHONE);
  });

  it('accepts custom replacement template', async () => {
    const result = await redactor.redact(
      'Email: test@example.com',
      { replacementTemplate: '[[PII_${type}]]' },
    );
    expect(result.redactedText).toBe('Email: [[PII_EMAIL]]');
  });

  it('accepts customPatterns for additional entity types', async () => {
    const result = await redactor.redact(
      'Internal ID: EMP-12345',
      {
        customPatterns: [
          { entityType: 'EMPLOYEE_ID', pattern: /\bEMP-\d{5}\b/g },
        ],
      },
    );
    expect(result.entities).toContainEqual(
      expect.objectContaining({
        entityType: PiiEntityType.CUSTOM,
        text: 'EMP-12345',
        confidence: 0.9,
      }),
    );
    expect(result.redactedText).toContain('[REDACTED_CUSTOM]');
  });

  it('combines built-in and custom patterns', async () => {
    const result = await redactor.redact(
      'Email: a@b.com, ID: EMP-99999',
      {
        enabledTypes: [PiiEntityType.EMAIL],
        customPatterns: [
          { entityType: 'EMPLOYEE_ID', pattern: /\bEMP-\d{5}\b/g },
        ],
      },
    );
    expect(result.redactedText).toBe('Email: [REDACTED_EMAIL], ID: [REDACTED_CUSTOM]');
  });

  it('empty enabledTypes means all patterns are used', async () => {
    const result = await redactor.redact('ssn: 123-45-6789', { enabledTypes: [] });
    expect(result.redactedText).toBe('ssn: [REDACTED_SSN]');
  });
});

// ---------------------------------------------------------------------------
// Overlapping entity deduplication
// ---------------------------------------------------------------------------

describe('RegexPiiRedactor — deduplication', () => {
  it('deduplicates overlapping entities keeping the wider match', async () => {
    // An email contains @ which might also partially overlap with other patterns
    // The wider match should be kept
    const text = 'Contact: team@company.org for details';
    const result = await redactor.analyze(text);

    // Find the EMAIL entity
    const emailEntity = result.entities.find((e) => e.entityType === PiiEntityType.EMAIL);
    expect(emailEntity).toBeDefined();
    expect(emailEntity!.text).toBe('team@company.org');

    // No other entity should overlap with the email span
    for (const entity of result.entities) {
      if (entity.entityType !== PiiEntityType.EMAIL) {
        // Non-email entities should not overlap with the email position
        const overlaps = entity.start < emailEntity!.end && entity.end > emailEntity!.start;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('handles multiple non-overlapping entities correctly', async () => {
    const result = await redactor.analyze(
      'Email a@b.com then call 555-000-1111 then SSN 123-45-6789',
    );
    const entities = result.entities;
    expect(entities.length).toBeGreaterThanOrEqual(3);

    // Entities should be non-overlapping and in order
    for (let i = 1; i < entities.length; i++) {
      expect(entities[i].start).toBeGreaterThanOrEqual(entities[i - 1].end);
    }
  });
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

describe('Public API', () => {
  describe('redactPii', () => {
    it('redacts PII from text using default redactor', async () => {
      const result = await redactPii('Email: user@example.com');
      expect(result.redactedText).toBe('Email: [REDACTED_EMAIL]');
    });

    it('accepts configuration', async () => {
      const result = await redactPii('Email: user@example.com, Phone: 555-000-1111', {
        enabledTypes: [PiiEntityType.PHONE],
      });
      expect(result.redactedText).toContain('[REDACTED_PHONE]');
      expect(result.redactedText).toContain('user@example.com');
    });
  });

  describe('redactPiiBatch', () => {
    it('redacts multiple text segments', async () => {
      const segments = [
        { text: 'Email: a@b.com' },
        { text: 'No PII here' },
        { text: 'Call 555-000-1111' },
      ];
      const results = await redactPiiBatch(segments);
      expect(results).toHaveLength(3);
      expect(results[0].redactedText).toContain('[REDACTED_EMAIL]');
      expect(results[1].redactedText).toBe('No PII here');
      expect(results[2].redactedText).toContain('[REDACTED_PHONE]');
    });

    it('preserves original text in results', async () => {
      const segments = [{ text: 'My email is test@test.com' }];
      const results = await redactPiiBatch(segments);
      expect(results[0].text).toBe('My email is test@test.com');
      expect(results[0].redactedText).not.toBe(results[0].text);
    });
  });

  describe('createPiiRedactor', () => {
    it('returns a new RegexPiiRedactor instance', () => {
      const instance = createPiiRedactor();
      expect(instance).toBeInstanceOf(RegexPiiRedactor);
    });

    it('each instance is independent', async () => {
      const a = createPiiRedactor();
      const b = createPiiRedactor();
      const [resultA, resultB] = await Promise.all([
        a.redact('Email: a@b.com'),
        b.redact('Email: c@d.com'),
      ]);
      expect(resultA.redactedText).toBe('Email: [REDACTED_EMAIL]');
      expect(resultB.redactedText).toBe('Email: [REDACTED_EMAIL]');
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('handles text with no alphanumeric characters', async () => {
    const result = await redactor.redact('!!! ??? ***');
    expect(result.redactedText).toBe('!!! ??? ***');
    expect(result.entities).toHaveLength(0);
  });

  it('handles very long text without performance issues', async () => {
    const longText = 'My email is user@example.com. '.repeat(100);
    const result = await redactor.redact(longText);
    // Should have 100 EMAIL entities
    expect(result.entities).toHaveLength(100);
    expect(result.redactedText).toContain('[REDACTED_EMAIL]');
  });

  it('handles Unicode characters', async () => {
    const result = await redactor.redact(
      '日本語メール: user@example.com, 電話: 555-123-4567',
    );
    expect(result.redactedText).toContain('[REDACTED_EMAIL]');
    expect(result.redactedText).toContain('[REDACTED_PHONE]');
    expect(result.redactedText).toContain('日本語メール');
  });

  it('preserves newlines in text', async () => {
    const result = await redactor.redact(
      'Line 1\nEmail: user@test.com\nLine 3',
    );
    expect(result.redactedText).toBe(
      'Line 1\nEmail: [REDACTED_EMAIL]\nLine 3',
    );
  });

  it('does not mutate the original text', async () => {
    const original = 'My email is user@example.com';
    const originalCopy = original.slice();
    const result = await redactor.redact(original);
    expect(original).toBe(originalCopy); // unchanged
    expect(result.redactedText).not.toBe(original); // different
  });

  it('returns correct entity positions in analyze', async () => {
    const text = 'Email: abc@def.com is valid';
    const result = await redactor.analyze(text);
    expect(result.entities).toHaveLength(1);
    const entity = result.entities[0];
    expect(text.slice(entity.start, entity.end)).toBe('abc@def.com');
  });

  it('empty enabledTypes defaults to all patterns', async () => {
    // Per getPatternsForTypes: empty array returns ALL patterns (by design)
    const result = await redactor.redact('Email: a@b.com', {
      enabledTypes: [],
    });
    expect(result.entities.length).toBeGreaterThan(0);
  });
});
