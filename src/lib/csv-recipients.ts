import type { CustomMergeTag } from "@/lib/custom-merge-tags";
import { customTagsToFieldDefaults } from "@/lib/custom-merge-tags";
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

/**
 * Recipients the campaign will use: first occurrence per email, valid address only
 * (excludes invalid and duplicate rows as flagged by the upload preview).
 */
function reservedFromDefaults(
  defaults: Record<string, string>,
  rowCells: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const fromRow = (rowCells[k] ?? "").trim();
    if (fromRow) return fromRow;
  }
  for (const k of keys) {
    const fromDefault = defaults[k]?.trim() ?? defaults[k.toLowerCase()]?.trim();
    if (fromDefault) return fromDefault;
  }
  return undefined;
}

export function parsedCsvToRecipientRows(
  parsed: ParsedCsv | null,
  customTags: CustomMergeTag[] = [],
): RecipientRow[] {
  if (!parsed) return [];
  const defaults = customTagsToFieldDefaults(customTags);
  const emailKey =
    parsed.columnOrder.find((c) => c.trim().toLowerCase() === "email") ?? "email";
  const out: RecipientRow[] = [];
  for (const row of parsed.rows) {
    if (row.invalidEmail || row.duplicate) continue;
    const raw = cell(row, emailKey);
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    const fromCsv = buildFieldsMap(row, parsed.columnOrder, emailKey) ?? {};
    const fields: Record<string, string> = { ...defaults, ...fromCsv };
    out.push({
      email,
      name: reservedFromDefaults(defaults, row.cells, "name", "Name"),
      c3: reservedFromDefaults(defaults, row.cells, "c3", "C3"),
      c4: reservedFromDefaults(defaults, row.cells, "c4", "C4"),
      c5: reservedFromDefaults(defaults, row.cells, "c5", "C5"),
      c6: reservedFromDefaults(defaults, row.cells, "c6", "C6"),
      fields: Object.keys(fields).length > 0 ? fields : undefined,
    });
  }
  return out;
}
