const MAX_TRANSCRIPT_LENGTH = 120000;

/**
 * Sanitizes user-provided content before embedding into LLM prompts.
 * Truncates to safe length and strips common prompt injection markers.
 */
export function sanitizeForPrompt(text: string): string {
  if (!text || typeof text !== 'string') return '';

  // Truncate to prevent token overflow and prompt stuffing
  let sanitized = text.length > MAX_TRANSCRIPT_LENGTH
    ? text.slice(0, MAX_TRANSCRIPT_LENGTH) + '\n\n[...truncated]'
    : text;

  // Strip common prompt injection delimiters that LLMs treat as instructions
  const injectionMarkers = [
    /ignore previous instructions/gi,
    /ignore all previous/gi,
    /you are now/gi,
    /system prompt/gi,
    /new instruction/gi,
    /\/\/\s*ignore/gi,
    /<!--\s*ignore/gi,
  ];

  for (const marker of injectionMarkers) {
    sanitized = sanitized.replace(marker, '[REDACTED]');
  }

  return sanitized;
}
