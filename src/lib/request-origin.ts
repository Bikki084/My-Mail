import type { NextRequest } from "next/server";

/**
 * Public origin for links in emails (no trailing slash).
 * Prefer NEXT_PUBLIC_APP_URL in production; otherwise derive from the incoming request.
 */
export function getPublicOrigin(request: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  const forwarded = request.headers.get("x-forwarded-host");
  const host = forwarded ?? request.headers.get("host");
  if (!host) return "http://localhost:3000";

  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
  return `${proto}://${host}`;
}
