import {
  DEFAULT_BUILT_IN_MERGE_TAGS,
  generateBuiltInFieldsForRecipient,
  type BuiltInMergeTagConfig,
} from "@/lib/built-in-merge-tags";
import type { RecipientRow } from "@/lib/merge-tags";
import type { CsvPreviewRow, ParsedCsv } from "@/lib/csv-types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cell(
  r: CsvPreviewRow,
  ...keys: string[]
): string {
  for (const k of keys) {
    if (k in r.cells) {
      return String(r.cells[k] ?? "");
    }
  }
  return "";
}

/**
 * Build the `fields` map carried on each recipient. Every CSV column other
 * than the email column is included, so arbitrary merge tags (e.g.
 * `{{{city}}}`, `{{{state}}}`) can be substituted at send time.
 */
function buildFieldsMap(
  row: CsvPreviewRow,
  columnOrder: string[],
  emailKey: string,
): Record<string, string> | undefined {
  const fields: Record<string, string> = {};
  for (const col of columnOrder) {
    if (col === emailKey) continue;
    const v = cell(row, col).trim();
    if (v === "") continue;
    fields[col] = v;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

export function parsedCsvToRecipientRows(
  parsed: ParsedCsv | null,
  builtInTags: BuiltInMergeTagConfig[] = DEFAULT_BUILT_IN_MERGE_TAGS,
): RecipientRow[] {
  if (!parsed) return [];
  const emailKey =
    parsed.columnOrder.find((c) => c.trim().toLowerCase() === "email") ?? "email";
  const out: RecipientRow[] = [];
  for (const row of parsed.rows) {
    if (row.invalidEmail || row.duplicate) continue;
    const raw = cell(row, emailKey);
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    const fromCsv = buildFieldsMap(row, parsed.columnOrder, emailKey) ?? {};
    const builtIn = generateBuiltInFieldsForRecipient(email, builtInTags);
    const fields: Record<string, string> = { ...fromCsv, ...builtIn };
    const nameVal = (row.cells.name ?? row.cells.Name ?? "").trim();
    out.push({
      email,
      name: nameVal || undefined,
      fields: Object.keys(fields).length > 0 ? fields : undefined,
    });
  }
  return out;
}
