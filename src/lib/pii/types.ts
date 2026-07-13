/**
 * PII Redaction Types
 *
 * Core types for the PII detection and redaction pipeline.
 * M0 uses regex-based detection; M1+ can swap in Microsoft Presidio
 * via the same interface.
 */

/**
 * Types of PII entities we can detect and redact.
 */
export enum PiiEntityType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  SSN = 'SSN', // US Social Security Number
  CREDIT_CARD = 'CREDIT_CARD',
  IP_ADDRESS = 'IP_ADDRESS',
  PERSON_NAME = 'PERSON_NAME',
  LOCATION = 'LOCATION',
  DATE_OF_BIRTH = 'DATE_OF_BIRTH',
  URL = 'URL',
  CRYPTO_WALLET = 'CRYPTO_WALLET',
  API_KEY = 'API_KEY',
  CUSTOM = 'CUSTOM',
}

/**
 * A single PII entity found in text.
 */
export interface PiiEntity {
  /** Type of PII detected */
  entityType: PiiEntityType;
  /** Start character position in the original text */
  start: number;
  /** End character position in the original text */
  end: number;
  /** The matched text snippet */
  text: string;
  /** Confidence score 0-1 */
  confidence: number;
}

/**
 * Result of a PII analysis pass.
 */
export interface PiiAnalysisResult {
  /** All entities found */
  entities: PiiEntity[];
  /** The original text (unchanged) */
  originalText: string;
}

/**
 * Result of a PII redaction pass.
 */
export interface PiiRedactionResult {
  /** Entities that were redacted */
  entities: PiiEntity[];
  /** The redacted text */
  redactedText: string;
  /** Map of redacted types to replacement strings used */
  replacementMap: Record<string, string>;
}

/**
 * Configuration for a PII redactor.
 */
export interface PiiRedactorConfig {
  /** Which entity types to detect (default: all) */
  enabledTypes?: PiiEntityType[];
  /** Custom replacement template, e.g. '[REDACTED_${type}]' */
  replacementTemplate?: string;
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  /** Custom regex patterns for PiiEntityType.CUSTOM */
  customPatterns?: Array<{
    entityType: string;
    pattern: RegExp;
  }>;
}

/**
 * Interface for PII redaction providers.
 * M0: RegexPiiRedactor (built-in patterns)
 * M1: PresidioPiiRedactor (Microsoft Presidio REST API)
 */
export interface PiiRedactor {
  /**
   * Analyze text and return all found PII entities without modifying text.
   */
  analyze(text: string, config?: PiiRedactorConfig): Promise<PiiAnalysisResult>;

  /**
   * Redact all found PII entities from the text, replacing with placeholders.
   */
  redact(text: string, config?: PiiRedactorConfig): Promise<PiiRedactionResult>;
}

/** Default replacement template */
export const DEFAULT_REPLACEMENT_TEMPLATE = '[REDACTED_${type}]';
