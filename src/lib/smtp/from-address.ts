import { resolveSendingDomain } from "@/lib/sending-domain";

/**
 * SMTP login username vs From header. Gmail/Yahoo use the same email for both;
 * Amazon SES uses an IAM access-key-style SMTP user (AKIA…) while From must be
 * @your verified domain (e.g. noreply@bulkfirepro.com — see APP_DOMAIN in brand.ts).
 */
export function isSesSmtpHost(host: string): boolean {
  return /email-smtp\.[a-z0-9-]+\.amazonaws\.com$/i.test(host.trim());
}

/** Brevo (Sendinblue) relay — SMTP login is account email; From uses verified domain. */
export function isBrevoSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "smtp-relay.brevo.com" || h === "smtp-relay.sendinblue.com";
}

/** Mailjet relay — SMTP login is API key + secret; From uses verified domain. */
export function isMailjetSmtpHost(host: string): boolean {
  return /\.mailjet\.com$/i.test(host.trim()) || host.trim().toLowerCase() === "in.mailjet.com";
}

/** SendGrid relay — SMTP username is literally `apikey`; From uses verified domain. */
export function isSendGridSmtpHost(host: string): boolean {
  return /\.sendgrid\.net$/i.test(host.trim());
}

/** True when SMTP username is an API-style key, not an email mailbox. */
export function isApiKeySmtpUsername(username: string): boolean {
  const u = username.trim();
  if (!u || u.includes("@")) return false;
  return (
    /^[a-f0-9]{20,}$/i.test(u) ||
    /^xkeysib-/i.test(u) ||
    u.toLowerCase() === "resend" ||
    u.toLowerCase() === "apikey"
  );
}

/** Mailgun relay — SMTP login is often postmaster@…; From uses verified domain. */
export function isMailgunSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "smtp.mailgun.org" || h === "smtp.eu.mailgun.org";
}

/**
 * Resend SMTP — username is the literal string `resend`, password is the API key.
 * From must be an address on the verified domain (see DKIM_DOMAIN).
 */
export function isResendSmtpHost(host: string): boolean {
  return host.trim().toLowerCase() === "smtp.resend.com";
}

/**
 * Mailercloud SMTP — login is often the account email (e.g. Gmail), but From must be
 * a verified Sender ID on the authenticated domain (see DKIM_DOMAIN).
 */
export function isMailercloudSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "smtp-prod.mailrcld.com" ||
    h === "smtp.mailrcld.com" ||
    h.endsWith(".mailrcld.com") ||
    h.endsWith(".mailercloud.com")
  );
}

/** Zoho Mail SMTP (personal smtp.zoho.* or org smtppro.zoho.*). */
export function isZohoSmtpHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return /^smtp(pro)?\.zoho(\.[a-z]{2,3})?(\.[a-z]{2})?$/.test(h);
}

export function isSesSmtpUsername(username: string): boolean {
  return /^AKIA[0-9A-Z]{16}$/i.test(username.trim());
}

export function resolveSmtpFromAddress(username: string, host: string): string {
  const user = username.trim();
  if (
    isSesSmtpUsername(user) ||
    isSesSmtpHost(host) ||
    isBrevoSmtpHost(host) ||
    isMailjetSmtpHost(host) ||
    isSendGridSmtpHost(host) ||
    isMailgunSmtpHost(host) ||
    isResendSmtpHost(host) ||
    isMailercloudSmtpHost(host) ||
    isZohoSmtpHost(host) ||
    isApiKeySmtpUsername(user)
  ) {
    return `noreply@${resolveSendingDomain()}`;
  }
  return user;
}
