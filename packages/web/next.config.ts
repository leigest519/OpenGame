import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  distDir: process.env.OPENGAME_NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['pg'],
  turbopack: { root: path.resolve(process.cwd(), '../..') },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
