/**
 * Xiaoyuzhou FM resolver (A1).
 *
 * Wraps the existing xiaoyuzhou client. Episode pages resolve to a single
 * ResolvedEpisode; podcast pages resolve to isMultiEpisode + episodes[].
 * platformId = the 24-hex eid/pid.
 */

import { isXiaoyuzhouUrl, parseXiaoyuzhouUrl } from '@/lib/xiaoyuzhou/parser';
import { getPodcast, getEpisode } from '@/lib/xiaoyuzhou/client';
import type { Resolver, ResolvedEpisode, ResolveCtx } from './types';
import { buildEpisodeKey } from './episode-key';

export const xiaoyuzhouResolver: Resolver = {
  name: 'xiaoyuzhou',
  canHandle(url) {
    return isXiaoyuzhouUrl(url);
  },
  async resolve(url, _ctx: ResolveCtx): Promise<ResolvedEpisode> {
    const parsed = parseXiaoyuzhouUrl(url);

    if (parsed.type === 'episode') {
      const { podcast, episode } = await getEpisode(parsed.id);
      return {
        platform: 'xiaoyuzhou',
        platformId: episode.eid,
        episodeKey: buildEpisodeKey('xiaoyuzhou', episode.eid),
        title: episode.title,
        description: episode.description,
        audioUrl: episode.audioUrl,
        durationSec: episode.duration,
        coverUrl: episode.image || podcast.image,
        showTitle: podcast.title,
        sourceUrl: url,
      };
    }

    // podcast (show) → multi-episode list
    const { podcast, episodes } = await getPodcast(parsed.id);
    const resolved: ResolvedEpisode[] = episodes.map((ep) => ({
      platform: 'xiaoyuzhou' as const,
      platformId: ep.eid,
      episodeKey: buildEpisodeKey('xiaoyuzhou', ep.eid),
      title: ep.title,
      description: ep.description,
      audioUrl: ep.audioUrl,
      durationSec: ep.duration,
      coverUrl: ep.image || podcast.image,
      showTitle: podcast.title,
      sourceUrl: `https://www.xiaoyuzhoufm.com/episode/${ep.eid}`,
    }));

    return {
      platform: 'xiaoyuzhou',
      platformId: podcast.pid,
      episodeKey: buildEpisodeKey('xiaoyuzhou', podcast.pid),
      title: podcast.title,
      description: podcast.description,
      audioUrl: '', // show has no single audio
      coverUrl: podcast.image,
      showTitle: podcast.title,
      sourceUrl: url,
      isMultiEpisode: true,
      episodes: resolved,
    };
  },
};
