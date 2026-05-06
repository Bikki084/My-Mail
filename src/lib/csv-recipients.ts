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
export function parsedCsvToRecipientRows(parsed: ParsedCsv | null): RecipientRow[] {
  if (!parsed) return [];
  const emailKey =
    parsed.columnOrder.find((c) => c.trim().toLowerCase() === "email") ?? "email";
  const out: RecipientRow[] = [];
  for (const row of parsed.rows) {
    if (row.invalidEmail || row.duplicate) continue;
    const raw = cell(row, emailKey);
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    out.push({
      email,
      name: cell(row, "name", "Name").trim() || undefined,
      c3: cell(row, "c3", "C3").trim() || undefined,
      c4: cell(row, "c4", "C4").trim() || undefined,
      c5: cell(row, "c5", "C5").trim() || undefined,
      c6: cell(row, "c6", "C6").trim() || undefined,
      fields: buildFieldsMap(row, parsed.columnOrder, emailKey),
    });
  }
  return out;
}
