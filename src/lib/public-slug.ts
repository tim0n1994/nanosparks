/**
 * Public slug generation (C1) — assigns /p/[slug] identifiers for SEO.
 *
 * Slugs are URL-safe, readable, and unique. For Chinese-heavy titles we keep the
 * CJK characters (search engines index them) but strip punctuation and collapse
 * whitespace. A short hash suffix guarantees uniqueness without an extra round-trip.
 */

import { prisma } from '@/lib/prisma';

const MAX_BASE = 40;
const SLUG_SUFFIX_LEN = 5;

/** Build a candidate slug base from a title (CJK retained, punctuation stripped). */
export function slugBase(title: string): string {
  return title
    .trim()
    .toLowerCase()
    // keep word chars (incl. CJK via \u4e00-\u9fff), spaces, hyphens
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_BASE);
}

/** 5-char base36 suffix from a cuid-ish seed for uniqueness. */
export function slugSuffix(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).padStart(SLUG_SUFFIX_LEN, '0').slice(-SLUG_SUFFIX_LEN);
}

/**
 * Allocate a unique public slug for a conversation/source. Idempotent: if one
 * already exists, return it. Otherwise mint base-suffix and verify uniqueness.
 */
export async function ensurePublicSlug(args: {
  title: string;
  conversationId: string;
  existingSlug?: string | null;
}): Promise<string> {
  if (args.existingSlug) return args.existingSlug;
  const base = slugBase(args.title) || 'episode';
  let slug = `${base}-${slugSuffix(args.conversationId)}`;

  // Collision guard (rare): append a counter until unique.
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = await prisma.source.findUnique({ where: { publicSlug: slug }, select: { id: true } });
    if (!clash) return slug;
    slug = `${base}-${slugSuffix(args.conversationId + attempt)}`;
  }
  return slug;
}
