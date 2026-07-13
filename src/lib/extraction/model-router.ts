/**
 * Model Router — sensitivity-based LLM routing
 *
 * Per Track C.4 of the iteration plan:
 *   sensitive → local (OpenAI-compatible endpoint, e.g. vLLM/llama.cpp)
 *   public    → cloud (flagship model)
 *
 * The routing strategy is configurable per workspace via Setting keys.
 * Falls back to the default LLM settings when routing is not configured.
 */

import { prisma } from '@/lib/prisma';
import { getLlmSettings, type LlmSettings } from '@/lib/settings';
import { logger } from '@/lib/logger';
import type { SourceConsentStatus } from '@/types/domain';

export type RoutingTier = 'local' | 'cloud';

export interface RoutedSettings extends LlmSettings {
  tier: RoutingTier;
}

const ROUTING_KEYS = {
  LOCAL_BASE_URL: 'routing_local_base_url',
  LOCAL_API_KEY: 'routing_local_api_key',
  LOCAL_MODEL: 'routing_local_model',
  CLOUD_BASE_URL: 'routing_cloud_base_url',
  CLOUD_API_KEY: 'routing_cloud_api_key',
  CLOUD_MODEL: 'routing_cloud_model',
} as const;

/**
 * Determine routing tier based on consent status.
 * Non-public consent → local (privacy-preserving).
 * Public → cloud (best quality).
 */
export function getRoutingTier(consentStatus: SourceConsentStatus | string): RoutingTier {
  if (consentStatus === 'public') return 'cloud';
  return 'local';
}

/**
 * Get LLM settings routed by consent status.
 * Falls back to default settings when routing-specific settings aren't configured.
 */
export async function getRoutedLlmSettings(
  consentStatus: SourceConsentStatus | string,
): Promise<RoutedSettings> {
  const tier = getRoutingTier(consentStatus);
  const defaultSettings = await getLlmSettings();

  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(ROUTING_KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const prefix = tier === 'local' ? 'LOCAL' : 'CLOUD';

    const baseUrl = map.get(ROUTING_KEYS[`${prefix}_BASE_URL` as keyof typeof ROUTING_KEYS]);
    const apiKey = map.get(ROUTING_KEYS[`${prefix}_API_KEY` as keyof typeof ROUTING_KEYS]);
    const model = map.get(ROUTING_KEYS[`${prefix}_MODEL` as keyof typeof ROUTING_KEYS]);

    if (baseUrl || apiKey || model) {
      logger.info('Routed LLM settings', {
        tier,
        model: model || defaultSettings.model,
        baseUrl: baseUrl ? '(configured)' : '(default)',
      });
      return {
        tier,
        baseUrl: baseUrl || defaultSettings.baseUrl,
        apiKey: apiKey || defaultSettings.apiKey,
        model: model || defaultSettings.model,
      };
    }
  } catch (error) {
    logger.warn('Failed to read routing settings, using default', { error: String(error) });
  }

  return { ...defaultSettings, tier };
}

/**
 * Get the consent status for a conversation by looking up its source.
 */
export async function getConsentStatusForConversation(
  conversationId: string,
): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      source: { select: { consentStatus: true } },
    },
  });

  return conversation?.source?.consentStatus ?? 'unknown';
}
