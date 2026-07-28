/**
 * Settings — LLM configuration store.
 *
 * Reads/writes LLM endpoint settings from the database (Setting table),
 * with environment-variable fallbacks so existing .env configs still work.
 *
 * Usage:
 *   import { getLlmSettings } from '@/lib/settings';
 *   const { baseUrl, apiKey, model } = await getLlmSettings();
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface LlmSettings {
  /** OpenAI-compatible base URL (e.g. http://127.0.0.1:59786/v1) */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** Model name (e.g. gpt-4o-mini, qwen3.5-35b-a3b) */
  /** API format: 'openai' (chat/completions) or 'anthropic' (/v1/messages) */
  apiFormat?: 'openai' | 'anthropic';
  model: string;
  /**
   * Optional second endpoint for load balancing. Same shape as the primary
   * (typically a different router path / model — e.g. glm-5.2 on /messages +
   * glm-5.1 on /messages-2). The LLM client round-robins calls across both.
   */
  secondary?: { baseUrl: string; model: string; apiFormat?: 'openai' | 'anthropic' };
}

const SETTING_KEYS = {
  LLM_BASE_URL: 'llm_base_url',
  LLM_API_KEY: 'llm_api_key',
  LLM_MODEL: 'llm_model',
  // Explicit API protocol selector: 'anthropic' (POST /v1/messages) or 'openai' (POST /v1/chat/completions).
  LLM_API_FORMAT: 'llm_api_format',
  // Secondary endpoint stored as JSON (baseUrl + model + apiFormat).
  LLM_SECONDARY: 'llm_secondary',
} as const;

/**
 * Normalize an endpoint base URL so client code can safely append the protocol path.
 * - strips a trailing slash
 * - strips an already-appended /messages or /chat/completions (users often paste the full URL)
 * - guarantees a version segment (/v1) so ClaudeClient/OpenAIClient can append /messages or /chat/completions
 */
export function normalizeEndpoint(rawBase: string): string {
  let base = (rawBase || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/messages$/, '').replace(/\/chat\/completions$/, '');
  if (!/\/v\d+$/.test(base)) base = `${base}/v1`;
  return base;
}

/**
 * Decide the wire protocol. An explicit stored value wins; otherwise infer from
 * the pasted URL (a /messages path implies Anthropic Messages API).
 */
export function detectApiFormat(rawBase: string, explicit?: string): 'openai' | 'anthropic' {
  if (explicit === 'anthropic' || explicit === 'openai') return explicit;
  if (/\/messages\b/.test(rawBase)) return 'anthropic';
  return 'openai';
}

/** Parse the secondary-endpoint JSON blob (baseUrl + model + apiFormat). */
function parseSecondary(raw: string | undefined): LlmSettings['secondary'] {
  if (!raw) return undefined;
  try {
    const s = JSON.parse(raw) as { baseUrl?: string; model?: string; apiFormat?: 'openai' | 'anthropic' };
    if (!s.baseUrl || !s.model) return undefined;
    return { baseUrl: s.baseUrl, model: s.model, apiFormat: s.apiFormat ?? detectApiFormat(s.baseUrl) };
  } catch {
    return undefined;
  }
}

/**
 * Read all LLM settings from DB, falling back to environment variables.
 */
export async function getLlmSettings(): Promise<LlmSettings> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const rawBase = map.get(SETTING_KEYS.LLM_BASE_URL) ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    const apiFormat = detectApiFormat(rawBase, map.get(SETTING_KEYS.LLM_API_FORMAT));

    return {
      baseUrl: normalizeEndpoint(rawBase),
      // Env fallback is format-aware: an anthropic-format endpoint should fall
      // back to ANTHROPIC_API_KEY, not only OPENAI_API_KEY (which is often a
      // local-router placeholder). Keys stay in env — never written to Setting.
      apiKey:
        map.get(SETTING_KEYS.LLM_API_KEY) ??
        (apiFormat === 'anthropic'
          ? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
          : process.env.OPENAI_API_KEY ?? ''),
      model: map.get(SETTING_KEYS.LLM_MODEL) ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      apiFormat,
      secondary: parseSecondary(map.get(SETTING_KEYS.LLM_SECONDARY)),
    };
  } catch (error) {
    logger.warn('Failed to read LLM settings from DB, falling back to env', { error: String(error) });
    const rawBase = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    const apiFormat = detectApiFormat(rawBase, process.env.LLM_API_FORMAT);
    return {
      baseUrl: normalizeEndpoint(rawBase),
      apiKey: process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      apiFormat,
    };
  }
}

/**
 * Persist LLM settings to the database.
 */
export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  const entries = [
    { key: SETTING_KEYS.LLM_BASE_URL, value: settings.baseUrl },
    { key: SETTING_KEYS.LLM_API_KEY, value: settings.apiKey },
    { key: SETTING_KEYS.LLM_MODEL, value: settings.model },
    ...(settings.apiFormat ? [{ key: SETTING_KEYS.LLM_API_FORMAT, value: settings.apiFormat }] : []),
    ...(settings.secondary
      ? [{ key: SETTING_KEYS.LLM_SECONDARY, value: JSON.stringify(settings.secondary) }]
      : []),
  ];

  for (const { key, value } of entries) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
