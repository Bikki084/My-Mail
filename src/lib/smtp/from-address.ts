/**
 * SMTP login username vs From header. Gmail/Yahoo use the same email for both;
 * Amazon SES uses an IAM access-key-style SMTP user (AKIA…) while From must be
 * @your verified domain (e.g. noreply@bulkfirepro.com).
 */
export function isSesSmtpHost(host: string): boolean {
  return /email-smtp\.[a-z0-9-]+\.amazonaws\.com$/i.test(host.trim());
}

export function isSesSmtpUsername(username: string): boolean {
  return /^AKIA[0-9A-Z]{16}$/i.test(username.trim());
}

export function resolveSmtpFromAddress(username: string, host: string): string {
  const user = username.trim();
  if (isSesSmtpUsername(user) || isSesSmtpHost(host)) {
    const domain = process.env.DKIM_DOMAIN?.trim().replace(/\.$/, "").replace(/^@/, "");
    if (domain && !domain.includes("@")) {
      return `noreply@${domain}`;
    }
  }
  return user;
}
