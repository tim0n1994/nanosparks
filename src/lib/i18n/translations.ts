/**
 * The message catalogue, assembled from per-domain files.
 *
 * Rebuilt rather than patched (PRD §5): the previous 346-line single file
 * described the *previous* product — "Turn podcasts into interactive idea
 * maps", "Analyze a Channel", "控制面板", "总剧集数" — none of which exist any
 * more. That mismatch is why newer pages bypassed i18n entirely and hardcoded
 * Chinese: the catalogue had no words for what they needed to say.
 *
 * Add new copy to the domain file it belongs to, never here.
 */

import { common } from './messages/common';
import { nav } from './messages/nav';
import { reader } from './messages/reader';
import { library } from './messages/library';
import { tools } from './messages/tools';

export type Lang = 'en' | 'zh';

const DOMAINS = [common, nav, reader, library, tools];

function assemble(lang: Lang): Record<string, string> {
  return Object.assign({}, ...DOMAINS.map((d) => d[lang]));
}

export const translations: Record<Lang, Record<string, string>> = {
  zh: assemble('zh'),
  en: assemble('en'),
};

export type TranslationKey = keyof (typeof common)['zh'] | string;
