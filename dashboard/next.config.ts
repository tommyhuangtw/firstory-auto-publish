import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules that must NOT be bundled by Turbopack — sqlite-vec's loader uses
  // import.meta.resolve (unsupported by Turbopack) to find its native binary.
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec'],

  // Prod now runs `next start` (built bundle) behind Cloudflare Tunnel
  // (hub.ailanbao.org → localhost:3000). These two are dev-only no-ops in production but
  // kept so `npm run dev` (local development) still behaves: allowedDevOrigins lets the
  // tunnel host load dev resources cross-origin; devIndicators hides the dev overlay that
  // would otherwise sit on the mobile bottom-nav.
  allowedDevOrigins: ['hub.ailanbao.org'],
  devIndicators: false,

  // Never cache the service worker so push-handler updates take effect immediately.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
