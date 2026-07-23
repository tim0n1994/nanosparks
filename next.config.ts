import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // bullmq + @resvg/resvg-js are native/CJS modules that Turbopack cannot
  // bundle as ESM assets; externalizing them keeps `next build` green.
  serverExternalPackages: ['bullmq', '@resvg/resvg-js'],
};

export default nextConfig;
