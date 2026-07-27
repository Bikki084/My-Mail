/** Primary production hostname (no protocol, no path). */
export const APP_DOMAIN = "bulkprofire.com";

/** HTTPS origin for links in emails and redirects (no trailing slash). */
export const APP_PUBLIC_URL = `https://${APP_DOMAIN}`;

/** Default noreply From local-part on the verified sending domain. */
export const APP_NOREPLY_EMAIL = `noreply@${APP_DOMAIN}`;

/** Short slug for email headers (Feedback-ID segment). */
export const APP_DOMAIN_SLUG = APP_DOMAIN.replace(/\./g, "");

/** User-facing product name (nav, titles, default email sender display name). */
export const APP_BRAND_NAME = "BulkProFire";

/** Default campaign From display name when the user leaves sender name empty. */
export const APP_DEFAULT_SENDER_NAME = "BulkProFire";
