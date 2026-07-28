import { APP_PUBLIC_URL } from "@/lib/brand";

/**
 * Public HTTPS origin for List-Unsubscribe one-click (RFC 8058).
 * Prefer MAILER_PUBLIC_URL; fall back to APP_PUBLIC_URL from brand.ts in production.
 */
export function resolveMailerPublicBaseUrl(): string | null {
  const explicit =
    process.env.MAILER_PUBLIC_URL?.trim().replace(/\/+$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    APP_PUBLIC_URL;
  if (!explicit) return null;
  if (!/^https:\/\//i.test(explicit)) {
    console.warn(
      "[mailer-public-url] MAILER_PUBLIC_URL must be HTTPS for one-click unsubscribe. Using mailto-only.",
    );
    return null;
  }
  if (/^https:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(explicit)) {
    return null;
  }
  return explicit;
}

export function isMailerPublicUrlConfigured(): boolean {
  return resolveMailerPublicBaseUrl() !== null;
}
