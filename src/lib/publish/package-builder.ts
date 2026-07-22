/**
 * PublishPackage orchestrator (B1) — 一鱼多吃 generator.
 *
 * Given a conversation, this builds the copy variants for each platform, runs
 * the sensitive-word filter, marks the package with hits, and persists a
 * PublishPackage row per (conversation, platform, variant). The actual LLM call
 * goes through the routed OpenAIClient so cost lands on ExtractionRun-style
 * accounting (recorded on PublishPackage.costUsd).
 *
 * PRD §B1 矩阵: 1 集 → 公众号 ×1 + 小红书 ×2-3 (quote/list/controversy) + 知乎 ×1.
 */

import { prisma } from '@/lib/prisma';
import type { OpenAIClient } from '@/lib/llm/client';
import type { ThoughtUnitLike } from './types';
import {
  buildXiaohongshuPrompt,
  buildWechatPrompt,
  buildZhihuPrompt,
  parseCopyResponse,
  sourceLine,
  type Platform,
  type Variant,
  type CopyInput,
} from './copy';
import { scanSensitiveWords } from './sensitive-words';
import { buildQuoteCard, buildListCard, buildCoverCard, type CardSpec } from './cards';
import { logger } from '@/lib/logger';

export interface BuildPackagesInput extends CopyInput {
  conversationId: string;
  userId: string;
  quotes: ThoughtUnitLike[];
  keyPoints: ThoughtUnitLike[];
}

export interface BuiltPackage {
  id: string;
  platform: Platform;
  variant: Variant;
  copyText: string;
  sensitiveHits: number;
  costUsd: number;
}

/** The default 一鱼多吃 matrix per PRD §B1. */
export const DEFAULT_MATRIX: Array<{ platform: Platform; variant: Variant }> = [
  { platform: 'wechat', variant: 'digest' },
  { platform: 'xiaohongshu', variant: 'quote' },
  { platform: 'xiaohongshu', variant: 'list' },
  { platform: 'xiaohongshu', variant: 'controversy' },
  // PRD §B1: 知乎回答版（结论先行+论据+出处），冷启动强于发文章。
  { platform: 'zhihu', variant: 'answer' },
];

/** Build + persist all packages in the matrix for one conversation. */
export async function buildPublishPackages(
  input: BuildPackagesInput,
  client: OpenAIClient,
  matrix: Array<{ platform: Platform; variant: Variant }> = DEFAULT_MATRIX,
): Promise<BuiltPackage[]> {
  const attribution = sourceLine(input);
  const out: BuiltPackage[] = [];

  for (const { platform, variant } of matrix) {
    const prompt = promptFor(platform, variant, input);
    let copyText = '';
    let costUsd = 0;
    try {
      const resp = await client.completeWithRetry(
        [{ role: 'user', content: prompt }],
        2000,
        2,
        true,
      );
      const parsed = parseCopyResponse(resp.content);
      copyText = JSON.stringify(parsed ?? { raw: resp.content, attribution });
      costUsd = estimateCostUsd(resp.usage);
    } catch (err) {
      logger.warn('copy generation failed for package', { platform, variant, error: String(err) });
      copyText = JSON.stringify({ error: 'generation_failed', attribution });
    }

    const hits = scanSensitiveWords(copyText).length;

    // Build card assets for this package (PRD §B1: 金句/清单/封面 cards).
    const cards = buildPackageCards(platform, variant, input);
    const assetsJson = { cards: cards.map((c) => ({ template: c.template, width: c.width, height: c.height })) };

    const pkg = await prisma.publishPackage.upsert({
      where: {
        conversationId_platform_variant: {
          conversationId: input.conversationId,
          platform,
          variant,
        },
      },
      // Persist sensitiveHits so the GET endpoint can surface it for UI highlight.
      update: { copyText, costUsd, userId: input.userId, sensitiveHits: hits, assetsJson },
      create: {
        conversationId: input.conversationId,
        userId: input.userId,
        platform,
        variant,
        copyText,
        costUsd,
        sensitiveHits: hits,
        assetsJson,
      },
    });

    out.push({
      id: pkg.id,
      platform,
      variant,
      copyText,
      sensitiveHits: hits,
      costUsd,
    });
  }

  return out;
}

/** Build the card specs for a platform+variant (PRD §B1 cards per package). */
function buildPackageCards(platform: Platform, variant: Variant, input: BuildPackagesInput): CardSpec[] {
  const showTitle = input.showTitle ?? undefined;
  const cards: CardSpec[] = [];
  cards.push(buildCoverCard(input.episodeTitle, showTitle, input.episodeNumber));
  if (input.quotes.length > 0 && (variant === 'quote' || platform === 'wechat')) {
    cards.push(...input.quotes.slice(0, 3).map((q) => buildQuoteCard(q, showTitle)));
  }
  if ((variant === 'list' || variant === 'digest') && input.keyPoints.length > 0) {
    cards.push(buildListCard('要点清单', input.keyPoints.slice(0, 5).map((p) => p.text), showTitle));
  }
  return cards;
}

function promptFor(platform: Platform, variant: Variant, input: BuildPackagesInput): string {
  if (platform === 'xiaohongshu') return buildXiaohongshuPrompt(input, variant as Variant);
  if (platform === 'wechat') return buildWechatPrompt(input);
  // PRD §B1: 知乎回答版（answer variant）→ answer prompt; else article.
  return buildZhihuPrompt(input, variant === 'answer' ? 'answer' : 'article');
}

/** Rough USD cost estimate from token usage (DeepSeek-class pricing: ~$0.14/1M in, $0.28/1M out). */
function estimateCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  const inCost = (usage.inputTokens / 1_000_000) * 0.14;
  const outCost = (usage.outputTokens / 1_000_000) * 0.28;
  return Math.round((inCost + outCost) * 10000) / 10000;
}
