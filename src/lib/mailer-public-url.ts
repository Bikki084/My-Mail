/**
 * Public origin for List-Unsubscribe HTTPS links (RFC 8058).
 * Requires HTTPS in production — Gmail/Yahoo bulk rules expect a working one-click URL.
 */
export function resolveMailerPublicBaseUrl(): string | null {
  const explicit = process.env.MAILER_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (explicit) {
    if (/^https:\/\//i.test(explicit)) return explicit;
    if (/^http:\/\//i.test(explicit)) {
      console.warn(
        "[mailer-public-url] MAILER_PUBLIC_URL is HTTP — HTTPS one-click unsubscribe is disabled. Use HTTPS or a reverse proxy with TLS.",
      );
    }
    return explicit;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (appUrl && /^https:\/\//i.test(appUrl)) return appUrl;

  return null;
}

export function isMailerPublicUrlConfigured(): boolean {
  return resolveMailerPublicBaseUrl() !== null;
}
