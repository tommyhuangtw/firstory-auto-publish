import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules that must NOT be bundled by Turbopack — sqlite-vec's loader uses
  // import.meta.resolve (unsupported by Turbopack) to find its native binary.
  serverExternalPackages: ['better-sqlite3', 'sqlite-vec'],
};

export default nextConfig;
