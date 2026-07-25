import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // bullmq + @resvg/resvg-js are native/CJS modules that Turbopack cannot
  // bundle as ESM assets; externalizing them keeps `next build` green.
  serverExternalPackages: ['bullmq', '@resvg/resvg-js'],
  images: {
    // Inline (not imported) — Turbopack reads next.config in its own context
    // and an import from src/ may not resolve there. Covers from any other
    // host fall back to a plain <img> in CoverImage.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: '**.xyzcdn.net' },
      { protocol: 'https', hostname: '**.mzstatic.com' },
      { protocol: 'https', hostname: '**.hdslb.com' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
