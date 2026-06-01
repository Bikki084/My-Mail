/**
 * Merge-tag substitution used by the composer preview *and* by the email worker
 * when actually sending. Templates can reference:
 *   - the well-known reserved keys (`email`, `name`, `c3`–`c6`)
 *   - any CSV column the user uploaded, surfaced through `row.fields`
 *   - built-in generators when a tag is not in the CSV (e.g. `random`, `date`)
 *
 * Supports both `{{key}}` and `{{{key}}}` (Mustache-style).
 */
import { randomId } from "@/lib/random-id";

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

function builtinTagValue(key: string, row: RecipientRow): string | undefined {
  const k = key.toLowerCase();
  switch (k) {
    case "random":
      return Math.random().toString(36).slice(2, 11);
    case "id": {
      const seed = row.email.trim().toLowerCase();
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      return `INV-${(h % 1_000_000).toString().padStart(6, "0")}`;
    }
    case "invoice":
      return `TX-${randomId().slice(0, 8).toUpperCase()}`;
    case "date":
      return new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    default:
      return undefined;
  }
}

export function applyMergeTags(template: string, row: RecipientRow): string {
  if (!template) return template ?? "";
  return template.replace(TAG_RE, (whole, tripleKey, doubleKey) => {
    const rawKey = (tripleKey ?? doubleKey ?? "").trim();
    if (!rawKey) return whole;
    const lower = rawKey.toLowerCase();
    if (RESERVED_KEYS.has(lower)) {
      const v = row[lower as Exclude<keyof RecipientRow, "fields">];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    const fromCsv = lookupField(row.fields, rawKey);
    if (fromCsv != null && fromCsv.trim() !== "") return fromCsv;
    const built = builtinTagValue(rawKey, row);
    if (built != null) return built;
    return whole;
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
  const builtins = ["name", "email", "random", "id", "invoice", "date"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...fromCsv, ...builtins]) {
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
  }
  return out;
}
