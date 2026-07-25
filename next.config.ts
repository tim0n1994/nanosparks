import type { NextConfig } from 'next';
import { IMAGE_HOST_PATTERNS } from './src/lib/image-hosts';

const nextConfig: NextConfig = {
  output: 'standalone',
  // bullmq + @resvg/resvg-js are native/CJS modules that Turbopack cannot
  // bundle as ESM assets; externalizing them keeps `next build` green.
  serverExternalPackages: ['bullmq', '@resvg/resvg-js'],
  images: {
    // Only the podcast CDNs we actually ingest from. A `**` wildcard here would
    // turn /_next/image into an open image proxy for any host on the internet;
    // covers from anywhere else fall back to a plain <img> in CoverImage.
    remotePatterns: IMAGE_HOST_PATTERNS.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
    })),
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
