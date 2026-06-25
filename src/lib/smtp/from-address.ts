/**
 * SMTP login username vs From header. Gmail/Yahoo use the same email for both;
 * Amazon SES uses an IAM access-key-style SMTP user (AKIA…) while From must be
 * @your verified domain (e.g. noreply@bulkfirepro.com).
 */
export function isSesSmtpHost(host: string): boolean {
  return /email-smtp\.[a-z0-9-]+\.amazonaws\.com$/i.test(host.trim());
}

/** Brevo (Sendinblue) relay — SMTP login is account email; From uses verified domain. */
export function isBrevoSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "smtp-relay.brevo.com" || h === "smtp-relay.sendinblue.com";
}

export function isSesSmtpUsername(username: string): boolean {
  return /^AKIA[0-9A-Z]{16}$/i.test(username.trim());
}

function domainFromAddressFromEnv(): string | null {
  const domain = process.env.DKIM_DOMAIN?.trim().replace(/\.$/, "").replace(/^@/, "");
  if (domain && !domain.includes("@")) return domain;
  return null;
}

export function resolveSmtpFromAddress(username: string, host: string): string {
  const user = username.trim();
  if (isSesSmtpUsername(user) || isSesSmtpHost(host) || isBrevoSmtpHost(host)) {
    const domain = domainFromAddressFromEnv();
    if (domain) return `noreply@${domain}`;
  }
  return user;
}
