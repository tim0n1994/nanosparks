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
 * Every cover renders as a plain <img> (not next/image): Next 16 + Turbopack's
 * /_next/image optimizer returns HTTP 400 ("url parameter is not allowed") for
 * allow-listed hosts in dev, and the podcast CDNs (ytimg / xyzcdn / mzstatic)
 * already serve cached, CDN-fronted images — re-optimizing adds a failure mode
 * with no benefit. The box is reserved even when src is missing, so layout
 * never shifts.
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
