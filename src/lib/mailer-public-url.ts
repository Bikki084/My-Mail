/**
 * Public HTTPS origin for List-Unsubscribe one-click (RFC 8058).
 * Only explicit MAILER_PUBLIC_URL is used — do not guess from APP_URL (often wrong).
 */
export function resolveMailerPublicBaseUrl(): string | null {
  const explicit = process.env.MAILER_PUBLIC_URL?.trim().replace(/\/+$/, "");
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
