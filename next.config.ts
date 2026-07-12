import type { NextConfig } from "next";

/** Staging dir only during `next build` — runtime `next start` must always use `.next`. */
function resolveDistDir(): string {
  const staging = process.env.NEXT_DIST_DIR?.trim();
  if (!staging || staging === ".next") return ".next";
  if (process.env.NEXT_PHASE === "phase-production-build") return staging;
  return ".next";
}

const nextConfig: NextConfig = {
  distDir: resolveDistDir(),
  // Hide the Next.js route/bundler dev badge (bottom-left "N" panel) during local dev.
  devIndicators: false,
  // Ensure NEXT_PUBLIC_* from .env.local are embedded in the client bundle at build time.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "",
  },
  // Used by Docker/Render images that copy `.next/standalone` (optional slimmer deploy).
  output: process.env.DOCKER_STANDALONE === "1" ? "standalone" : undefined,
  // pdf-parse / pdfjs-dist must run from node_modules; bundling breaks workers and text extraction.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "puppeteer"],
  productionBrowserSourceMaps: false,
  // On small Lightsail VPS, set SKIP_NEXT_TYPECHECK=1 during `npm run build:prod` to avoid OOM.
  typescript: {
    ignoreBuildErrors: process.env.SKIP_NEXT_TYPECHECK === "1",
  },
  // Larger JSON bodies for /api/campaigns with small PDF attachments (base64)
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Multipart (PDF uploads) and large JSON fallbacks
    proxyClientMaxBodySize: "32mb",
  },
};

export default nextConfig;
