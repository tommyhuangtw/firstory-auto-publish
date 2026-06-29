import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules that must NOT be bundled by Turbopack — sqlite-vec's loader uses
  // import.meta.resolve (unsupported by Turbopack) to find its native binary.
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec'],

  // The dashboard is served publicly via Cloudflare Tunnel (hub.ailanbao.org → localhost:3000)
  // while still running `next dev`. Next dev blocks cross-origin dev resources (Turbopack HMR
  // runtime) by default, which prevents the client bundle from hydrating when accessed via the
  // tunnel host — leaving all buttons dead and client-fetched panels (Pipeline Timeline, etc.)
  // stuck loading. Allow the public host so dev resources load cross-origin.
  allowedDevOrigins: ['hub.ailanbao.org'],

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
