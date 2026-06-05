/** Consumer Microsoft mailbox domains (Outlook.com, Hotmail, Live, etc.). */
export const MICROSOFT_CONSUMER_DOMAINS = new Set([
  "outlook.com",
  "outlook.co.uk",
  "outlook.fr",
  "outlook.de",
  "outlook.in",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.in",
  "live.com",
  "live.co.uk",
  "live.fr",
  "msn.com",
]);

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "ymail.com",
  ...MICROSOFT_CONSUMER_DOMAINS,
  "aol.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
]);

export function domainOfEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

export function isMicrosoftMailbox(email: string): boolean {
  return MICROSOFT_CONSUMER_DOMAINS.has(domainOfEmail(email));
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.trim().toLowerCase());
}
