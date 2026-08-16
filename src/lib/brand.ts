/** Primary production hostname (no protocol, no path). */
export const APP_DOMAIN = "mailshooter.in";

/** First label of APP_DOMAIN (same letter order as APP_BRAND_NAME). */
export const APP_DOMAIN_LABEL = APP_DOMAIN.split(".")[0] ?? "mailshooter";

/** HTTPS origin for links in emails and redirects (no trailing slash). */
export const APP_PUBLIC_URL = `https://${APP_DOMAIN}`;

/** Default noreply From local-part on the verified sending domain. */
export const APP_NOREPLY_EMAIL = `noreply@${APP_DOMAIN}`;

/** Short slug for email headers (Feedback-ID segment). */
export const APP_DOMAIN_SLUG = APP_DOMAIN.replace(/\./g, "");

/**
 * User-facing product / company display name — the only source of truth for
 * `company_name` in generation, verification, UI, and default sender.
 */
export const APP_BRAND_NAME = "MailShooter";

/** Legacy / wrong-order names that must rewrite to APP_BRAND_NAME. */
export const APP_BRAND_WRONG_LETTER_ORDER = "BulkProFire";

const LEGACY_BRAND_ALIASES = ["BulkProFire", "Bulkfirepro", "BulkFirePro", "Mailshooter"] as const;

/** Default campaign From display name when the user leaves sender name empty. */
export const APP_DEFAULT_SENDER_NAME = APP_BRAND_NAME;

function collapseCompanyToken(value: string): string {
  return value.trim().replace(/[\s._-]+/g, "").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBrandLetterOrder(name: string): boolean {
  const token = collapseCompanyToken(name);
  return (
    token === collapseCompanyToken(APP_BRAND_NAME) ||
    token === collapseCompanyToken(APP_DOMAIN_LABEL)
  );
}

function isLegacyBrandAlias(name: string): boolean {
  const token = collapseCompanyToken(name);
  return LEGACY_BRAND_ALIASES.some((alias) => token === collapseCompanyToken(alias));
}

/**
 * Canonical company_name for generation + verification.
 * Mailshooter (any casing) and legacy Bulkfirepro / BulkProFire map to APP_BRAND_NAME.
 * Custom sender names (e.g. Acme) are preserved.
 */
export function resolveCanonicalCompanyName(senderName?: string | null): string {
  const s = (senderName || "").trim();
  if (!s) return APP_BRAND_NAME;
  if (isBrandLetterOrder(s) || isLegacyBrandAlias(s)) return APP_BRAND_NAME;
  return s;
}

/**
 * Replace legacy / off-casing brand tokens with APP_BRAND_NAME.
 * Leaves hostnames intact (`mailshooter.in`, `bulkfirepro.com`).
 */
export function applyCanonicalBrandName(
  text: string,
  brand: string = APP_BRAND_NAME,
): string {
  if (!text) return text;
  let out = text;
  for (const alias of LEGACY_BRAND_ALIASES) {
    if (collapseCompanyToken(alias) === collapseCompanyToken(brand)) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b(?!\\.[a-z])`, "gi"), brand);
  }
  const label = APP_DOMAIN_LABEL;
  if (label) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(label)}\\b(?!\\.[a-z])`, "gi"), brand);
  }
  return out;
}

/**
 * Case/spacing-tolerant mention check — not letter-order-tolerant.
 * Does not count the name inside a hostname (`mailshooter.in`).
 */
export function textMentionsCompanyName(haystack: string, company: string): boolean {
  const name = company.trim().replace(/\s+/g, " ");
  if (!name) return false;
  const collapsed = haystack.replace(/\s+/g, " ");
  const re = new RegExp(`\\b${escapeRegExp(name)}\\b(?!\\.[a-z])`, "i");
  return re.test(collapsed);
}
