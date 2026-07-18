/**
 * HTTP security headers for production (securityheaders.com / browser hardening).
 * Kept permissive enough for Next.js App Router (inline scripts/styles, Supabase).
 */

function supabaseConnectSources(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!raw || raw.includes("your-project")) return "";
  try {
    const host = new URL(raw).host;
    return ` https://${host} wss://${host}`;
  } catch {
    return "";
  }
}

/** Content-Security-Policy tuned for this Next.js + Supabase app without breaking UI. */
export function buildContentSecurityPolicy(): string {
  const supabase = supabaseConnectSources();
  const connectParts = ["'self'", "blob:", "https://*.supabase.co", "wss://*.supabase.co"];
  if (supabase) connectParts.push(supabase.trim());
  const connectSrc = connectParts.join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    // Next.js hydration and RSC need inline/eval in this stack.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob: https://cdn.jsdelivr.net",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export type SecurityHeader = { key: string; value: string };

/** Headers recommended by securityheaders.com (safe defaults for this app). */
export function getSecurityHeaders(options?: { production?: boolean }): SecurityHeader[] {
  const production = options?.production ?? process.env.NODE_ENV === "production";

  const headers: SecurityHeader[] = [
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
  ];

  if (production) {
    headers.unshift({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }

  return headers;
}
