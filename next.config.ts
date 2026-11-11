import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baked into both the app and the server at build time; see lib/build.ts.
  env: { KRO5_BUILD: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
  // The screenshot tool's headless Chromium (lib/screenshot.ts) is unpacked from these files at run time,
  // so they stay out of the bundle and ship whole with the chat function.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: { "/api/chat": ["./node_modules/@sparticuz/chromium/bin/**"] },
};

export default nextConfig;
