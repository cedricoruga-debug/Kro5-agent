import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baked into both the app and the server at build time; see lib/build.ts.
  env: { KRO5_BUILD: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
};

export default nextConfig;
