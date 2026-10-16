import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up and picks the
  // nearest package-lock.json it finds, which breaks module resolution.
  turbopack: {
    root: __dirname,
  },
  // No Next.js badge in the corner during development.
  devIndicators: false,
  eslint: {
    // These warnings come from upstream LiveKit/AI UI components, not our code.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
