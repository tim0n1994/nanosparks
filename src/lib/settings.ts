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
}

const SETTING_KEYS = {
  LLM_BASE_URL: 'llm_base_url',
  LLM_API_KEY: 'llm_api_key',
  LLM_MODEL: 'llm_model',
  // Explicit API protocol selector: 'anthropic' (POST /v1/messages) or 'openai' (POST /v1/chat/completions).
  LLM_API_FORMAT: 'llm_api_format',
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
      apiKey: map.get(SETTING_KEYS.LLM_API_KEY) ?? process.env.OPENAI_API_KEY ?? '',
      model: map.get(SETTING_KEYS.LLM_MODEL) ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      apiFormat,
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
  ];

  for (const { key, value } of entries) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
