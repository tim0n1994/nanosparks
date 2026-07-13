/**
 * Regex-Based PII Redactor (M0)
 *
 * Uses predefined regex patterns to detect and redact PII.
 * M1: Replace with Microsoft Presidio REST API for production-grade detection.
 *
 * Design:
 * - Runs pattern matching across the full text
 * - Deduplicates overlapping matches (keeps the wider entity)
 * - Replaces matched text with configurable placeholders
 * - Returns both the redacted text and metadata about what was redacted
 */

import {
  PiiEntity,
  PiiEntityType,
  PiiAnalysisResult,
  PiiRedactionResult,
  PiiRedactor,
  PiiRedactorConfig,
  DEFAULT_REPLACEMENT_TEMPLATE,
} from './types';
import { getPatternsForTypes } from './patterns';

/**
 * M0 regex-based PII redactor.
 * Stateless — instantiate once and reuse.
 */
export class RegexPiiRedactor implements PiiRedactor {
  /**
   * Analyze text and return all found PII entities.
   */
  async analyze(text: string, config?: PiiRedactorConfig): Promise<PiiAnalysisResult> {
    const patterns = getPatternsForTypes(config?.enabledTypes);
    const minConfidence = config?.minConfidence ?? 0;
    const customPatterns = config?.customPatterns ?? [];

    const allEntities: PiiEntity[] = [];

    // Run built-in patterns
    for (const p of patterns) {
      if (p.confidence < minConfidence) continue;

      let match: RegExpExecArray | null;
      // Reset regex state
      p.pattern.lastIndex = 0;
      while ((match = p.pattern.exec(text)) !== null) {
        allEntities.push({
          entityType: p.entityType,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          confidence: p.confidence,
        });
      }
    }

    // Run custom patterns
    for (const cp of customPatterns) {
      let match: RegExpExecArray | null;
      cp.pattern.lastIndex = 0;
      while ((match = cp.pattern.exec(text)) !== null) {
        allEntities.push({
          entityType: PiiEntityType.CUSTOM,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          confidence: 0.9,
        });
      }
    }

    // Deduplicate overlapping entities
    // Sort by start position, then by end position descending (wider match first)
    allEntities.sort((a, b) => a.start - b.start || b.end - a.end);

    const deduplicated: PiiEntity[] = [];
    for (const entity of allEntities) {
      const last = deduplicated[deduplicated.length - 1];
      if (last && entity.start < last.end) {
        // Overlap: keep the wider one (first in sort order since wider ends later)
        continue;
      }
      deduplicated.push(entity);
    }

    return {
      entities: deduplicated,
      originalText: text,
    };
  }

  /**
   * Redact all found PII entities, replacing with placeholders.
   */
  async redact(text: string, config?: PiiRedactorConfig): Promise<PiiRedactionResult> {
    const template = config?.replacementTemplate ?? DEFAULT_REPLACEMENT_TEMPLATE;
    const { entities } = await this.analyze(text, config);

    if (entities.length === 0) {
      return {
        entities: [],
        redactedText: text,
        replacementMap: {},
      };
    }

    // Build replacement map
    const replacementMap: Record<string, string> = {};
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];

    for (const entity of entities) {
      const typeKey = entity.entityType;
      if (!replacementMap[typeKey]) {
        replacementMap[typeKey] = template.replace('${type}', typeKey);
      }
      replacements.push({
        start: entity.start,
        end: entity.end,
        replacement: replacementMap[typeKey],
      });
    }

    // Apply replacements from right to left to preserve positions
    replacements.sort((a, b) => b.start - a.start);

    let redactedText = text;
    for (const r of replacements) {
      redactedText =
        redactedText.slice(0, r.start) + r.replacement + redactedText.slice(r.end);
    }

    return {
      entities,
      redactedText,
      replacementMap,
    };
  }
}
