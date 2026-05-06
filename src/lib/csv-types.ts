/**
 * Shared types for the client CSV uploader and campaign recipient pipeline.
 * Kept in `lib` so `email-campaign-context` does not import `csv-table` (cycle).
 */
export type CsvPreviewRow = {
  id: string;
  cells: Record<string, string>;
  duplicate?: boolean;
  invalidEmail?: boolean;
};

export type ParsedCsv = {
  fileName: string;
  /** Display order: email column first, then remaining headers in file order */
  columnOrder: string[];
  rows: CsvPreviewRow[];
  totalCount: number;
};
