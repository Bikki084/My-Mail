/**
 * After a successful bulk SMTP import, we remember the inserted row ids so the
 * Email Composer can scope the next campaign(s) to **only** those accounts for
 * rotation — instead of every server ever saved on the account.
 */
export const LAST_BULK_SMTP_IDS_KEY = "mymail:lastBulkSmtpIds";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function setLastBulkImportedSmtpIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  const clean = ids.map((x) => x.trim()).filter((x) => UUID_RE.test(x));
  if (clean.length === 0) {
    window.sessionStorage.removeItem(LAST_BULK_SMTP_IDS_KEY);
    return;
  }
  window.sessionStorage.setItem(LAST_BULK_SMTP_IDS_KEY, JSON.stringify(clean));
}

export function getLastBulkImportedSmtpIds(): string[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(LAST_BULK_SMTP_IDS_KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return null;
    const out = j
      .filter((x): x is string => typeof x === "string" && UUID_RE.test(x.trim()))
      .map((x) => x.trim());
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function clearLastBulkImportedSmtpIds(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(LAST_BULK_SMTP_IDS_KEY);
}
