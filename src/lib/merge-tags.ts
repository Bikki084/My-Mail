/**
 * Merge-tag substitution used by the composer preview and by the email worker.
 * Only substitutes values from the recipient row (reserved keys + CSV `fields`).
 * Unknown tags render as a visible missing marker — never fake generated data.
 *
 * Supports both `{{key}}` and `{{{key}}}` (Mustache-style).
 */
export type RecipientRow = {
  email: string;
  name?: string;
  c3?: string;
  c4?: string;
  c5?: string;
  c6?: string;
  /**
   * Arbitrary key/value pairs sourced from CSV columns that don't map to a
   * reserved field. Lookup is case-insensitive — `{{{City}}}` and
   * `{{{city}}}` both find the same value.
   */
  fields?: Record<string, string>;
};

/** Reserved keys that always live as named properties on the row. */
const RESERVED_KEYS = new Set(["email", "name", "c3", "c4", "c5", "c6"]);

/** Triple `{{{key}}}` or double `{{key}}` — both must be supported at send time. */
const TAG_RE = /\{\{\{\s*([\w.-]+)\s*\}\}\}|\{\{\s*([\w.-]+)\s*\}\}/g;

export const MISSING_TAG_HTML =
  '<strong style="font-weight:700;color:#b91c1c;">Missing tag</strong>';
export const MISSING_TAG_PLAIN = "Missing tag";

export type MergeTagMissingFormat = "html" | "plain";

function lookupField(
  fields: Record<string, string> | undefined,
  key: string,
): string | undefined {
  if (!fields) return undefined;
  if (key in fields) return fields[key];
  const lower = key.toLowerCase();
  for (const fk of Object.keys(fields)) {
    if (fk.toLowerCase() === lower) return fields[fk];
  }
  return undefined;
}

function resolveTagValue(rawKey: string, row: RecipientRow): string | undefined {
  const lower = rawKey.toLowerCase();
  if (RESERVED_KEYS.has(lower)) {
    const v = row[lower as Exclude<keyof RecipientRow, "fields">];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  const fromCsv = lookupField(row.fields, rawKey);
  if (fromCsv != null && fromCsv.trim() !== "") return fromCsv;
  return undefined;
}

export function applyMergeTags(
  template: string,
  row: RecipientRow,
  options?: { missingFormat?: MergeTagMissingFormat },
): string {
  if (!template) return template ?? "";
  const missingFormat = options?.missingFormat ?? "html";
  const missing =
    missingFormat === "plain" ? MISSING_TAG_PLAIN : MISSING_TAG_HTML;
  return template.replace(TAG_RE, (whole, tripleKey, doubleKey) => {
    const rawKey = (tripleKey ?? doubleKey ?? "").trim();
    if (!rawKey) return whole;
    const value = resolveTagValue(rawKey, row);
    if (value != null) return value;
    return missing;
  });
}

/** Column keys available for merge tags from a parsed CSV (for UI pickers). */
export function mergeTagKeysFromCsv(columnOrder: string[]): string[] {
  const emailKey =
    columnOrder.find((c) => c.trim().toLowerCase() === "email") ?? "email";
  const fromCsv = columnOrder
    .filter((c) => c !== emailKey)
    .map((c) => c.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of fromCsv) {
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out;
}
