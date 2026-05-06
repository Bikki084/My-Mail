import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
