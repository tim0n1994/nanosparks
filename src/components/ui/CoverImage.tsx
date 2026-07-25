import { cn } from '@/lib/utils';

interface CoverImageProps {
  src: string | null | undefined;
  /** Decorative by default — the title always sits next to the cover. */
  alt?: string;
  size: number;
  className?: string;
  priority?: boolean;
}

/**
 * Podcast cover art.
 *
 * Every cover renders as a plain <img>, not next/image. This is a deliberate
 * deviation from the UI/UX plan §4.2, kept because the optimizer measurably
 * does not work here:
 *
 *   GET /_next/image?url=<i.ytimg.com cover>&w=128&q=75
 *     → 504 "url parameter is valid but upstream response timed out"
 *   curl of that same URL from the same host
 *     → 200 in ~0.5s
 *
 * So the allow-list in next.config is correct (the optimizer calls the url
 * "valid") and egress is fine — the optimizer's own upstream fetch is what
 * hangs. Re-check with the probe above before reinstating next/image; an
 * earlier note here blamed a 400 / missing allow-list entry, which is no
 * longer the symptom and sends you to fix the wrong file.
 *
 * The trade is also favourable on its own terms: podcast CDNs (ytimg /
 * xyzcdn / mzstatic) already serve cached, CDN-fronted, correctly-sized art,
 * so optimizing buys little, while a failing optimizer means *no cover at
 * all*. width/height are always set, so there is no layout shift either way.
 */
export default function CoverImage({
  src,
  alt = '',
  size,
  className,
  priority,
}: CoverImageProps) {
  const box = cn('flex-shrink-0 rounded-lg bg-surface-sunken object-cover', className);

  if (!src) {
    return <div className={box} style={{ width: size, height: size }} aria-hidden="true" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN images, not optimized
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={box}
    />
  );
}
