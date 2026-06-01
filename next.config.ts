import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
