import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Two dev servers can't share one build directory. The partner copy
  // (npm run dev:partner) sets this so it can run alongside the main one.
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
};

export default nextConfig;
