import Image from 'next/image';
import { isOptimizableImage } from '@/lib/image-hosts';
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
 * Covers come from whatever CDN the source platform uses, and that set is
 * open-ended. Known hosts go through next/image (AVIF/WebP, correct srcset);
 * everything else renders as a plain <img> rather than throwing
 * "hostname is not configured". Both paths reserve the same box, so the
 * layout never shifts when a cover loads.
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

  if (isOptimizableImage(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        priority={priority}
        className={box}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- unknown CDN: optimising it would need an open-host allowlist
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
