/**
 * Merge-tag substitution used by the composer preview *and* by the email worker
 * when actually sending. Templates can reference:
 *   - the well-known reserved keys (`email`, `name`, `c3`–`c6`)
 *   - any CSV column the user uploaded, surfaced through `row.fields`
 *
 * The engine is intentionally permissive about brace style and whitespace so
 * Mustache-style triples (`{{{city}}}`) and the more common doubles
 * (`{{ city }}`) both resolve.
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

/**
 * Matches `{{key}}` and `{{{key}}}`. The key may contain word characters,
 * dots, dashes, or underscores — same character set the merge-tag editor
 * accepts when CSV columns are imported as tags.
 */
const TAG_RE = /\{\{\{?\s*([\w.-]+)\s*\}?\}\}/g;

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

export function applyMergeTags(template: string, row: RecipientRow): string {
  if (!template) return template ?? "";
  return template.replace(TAG_RE, (whole, rawKey: string) => {
    const lower = rawKey.toLowerCase();
    if (RESERVED_KEYS.has(lower)) {
      const v = row[lower as Exclude<keyof RecipientRow, "fields">];
      return v != null ? String(v) : "";
    }
    const v = lookupField(row.fields, rawKey);
    if (v != null) return String(v);
    // Unknown tag — leave the literal in place so the author can spot the
    // missing CSV column instead of silently producing a blank.
    return whole;
  });
}
