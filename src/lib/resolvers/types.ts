/**
 * Resolver Chain — shared types (A1).
 *
 * Each source (xiaoyuzhou/youtube/apple/spotify/rss/bilibili/direct/generic)
 * implements the `Resolver` interface and returns a normalized `ResolvedEpisode`.
 * The chain is the single entry point that replaces the inline if/else branching
 * that used to live in src/app/api/ingest/route.ts.
 *
 * Source of truth for platforms is the Prisma `SourcePlatform` enum; this module
 * re-exports it so resolver code stays decoupled from the DB layer at the type level.
 */

// SourcePlatform is a Prisma enum: a runtime const object AND a derived type.
// Import the value so it can be compared, and the type via typeof.
import { SourcePlatform as SourcePlatformEnum } from '@/generated/prisma/client';

export type SourcePlatform = (typeof SourcePlatformEnum)[keyof typeof SourcePlatformEnum];
export { SourcePlatform as SourcePlatformValue } from '@/generated/prisma/client';

/** Context handed to every resolver (cookies enable authenticated scraping). */
export interface ResolveCtx {
  /** Cookie header value for sources that require login (B站充电/YouTube age gate). */
  cookies?: string;
  /** AbortSignal to cancel in-flight network requests. */
  signal?: AbortSignal;
}

/**
 * A single normalized episode produced by a resolver.
 * `episodeKey` is the global cache key (`${platform}:${platformId}`).
 * For podcast/feed sources that resolve to many episodes, set `isMultiEpisode`
 * and populate `episodes[]` instead of the single-episode fields.
 */
export interface ResolvedEpisode {
  platform: SourcePlatform;
  /** Platform-native id (no native id → audio content-hash fallback). */
  platformId: string;
  /** `${platform}:${platformId}` — global cache key. */
  episodeKey: string;
  title: string;
  description?: string;
  /** Directly downloadable enclosure / audio URL. */
  audioUrl: string;
  durationSec?: number;
  coverUrl?: string;
  /** Show / podcast / channel title. */
  showTitle?: string;
  /** Original submitted URL — preserved for copyright backlinks. */
  sourceUrl: string;
  /** True when the resolved URL is a feed/show rather than a single episode. */
  isMultiEpisode?: boolean;
  episodes?: ResolvedEpisode[];
}

/** A resolver module. `canHandle` is a cheap URL-shape check; `resolve` does I/O. */
export interface Resolver {
  name: SourcePlatform;
  canHandle(url: string): boolean;
  resolve(url: string, ctx: ResolveCtx): Promise<ResolvedEpisode>;
}

/** Typed resolver error carrying a human-readable classification. */
export type ResolverErrorKind =
  | 'login_required'
  | 'region_restricted'
  | 'no_audio'
  | 'not_found'
  | 'spotify_exclusive'
  /// Platform reachable in principle but the metadata fetch failed (timeout,
  /// block). The client offers discover-by-name as a way around it.
  | 'platform_unreachable'
  | 'unknown';

export class ResolverError extends Error {
  constructor(
    message: string,
    public readonly kind: ResolverErrorKind,
    public readonly platform: SourcePlatform,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ResolverError';
  }
}
