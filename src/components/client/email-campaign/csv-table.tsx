"use client";

import * as React from "react";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  Pencil,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  builtInTagLabel,
  generateBuiltInFieldsForRecipient,
  type BuiltInMergeTagConfig,
  type BuiltInMergeTagId,
} from "@/lib/built-in-merge-tags";
import { cn } from "@/lib/utils";
import type { CsvPreviewRow, ParsedCsv } from "@/lib/csv-types";
import { useEmailCampaign } from "./email-campaign-context";
import { toast } from "sonner";

export type { CsvPreviewRow, ParsedCsv };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROWS_PER_PAGE = 10;

function mergeTagDisplay(key: string) {
  return `{{{${key}}}}`;
}

function isLikelyCsv(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return true;
  if (file.type === "text/csv" || file.type === "application/csv") return true;
  return false;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidEmail(raw: string): boolean {
  const s = raw.trim();
  return s.length > 0 && EMAIL_RE.test(s);
}

/** Normalize header cells (BOM, spacing) and match common email column names. */
function resolveEmailColumnKey(fields: string[]): string | null {
  const normalized = fields.map((f) => ({
    raw: f,
    norm: f.replace(/^\uFEFF/, "").trim().toLowerCase(),
  }));
  const exact = normalized.find((f) => f.norm === "email");
  if (exact) return exact.raw;
  const loose = normalized.find(
    (f) =>
      f.norm === "e-mail" ||
      f.norm === "email address" ||
      f.norm === "emailaddress" ||
      f.norm === "mail" ||
      f.norm.endsWith(" email") ||
      f.norm.includes("email"),
  );
  return loose?.raw ?? null;
}

function buildParsedFromParseResult(
  fileName: string,
  res: Papa.ParseResult<Record<string, string>>,
): ParsedCsv | { error: string } {
  const rawFields =
    res.meta.fields
      ?.map((f) => (f != null ? String(f).replace(/^\uFEFF/, "").trim() : ""))
      .filter((f) => f !== "") ?? [];
  if (!rawFields.length && res.data.length === 0) {
    return { error: "CSV has no headers or data." };
  }

  const emailKey = resolveEmailColumnKey(rawFields);
  if (!emailKey) {
    const preview = rawFields.slice(0, 8).join(", ") || "(none)";
    return {
      error: `CSV must include an "email" column (first row). Found: ${preview}`,
    };
  }

  const otherKeys = rawFields.filter((f) => f !== emailKey);
  const columnOrder = [emailKey, ...otherKeys];

  const emailSeen = new Set<string>();
  const rows: CsvPreviewRow[] = res.data.map((row, index) => {
    const cells: Record<string, string> = {};
    for (const key of rawFields) {
      cells[key] = row[key] != null ? String(row[key]) : "";
    }
    const emailRaw = cells[emailKey] ?? "";
    const norm = normalizeEmail(emailRaw);
    const invalidEmail = !isValidEmail(emailRaw);
    let duplicate = false;
    if (norm.length > 0) {
      if (emailSeen.has(norm)) duplicate = true;
      else emailSeen.add(norm);
    }

    return {
      id: `row-${index}`,
      cells,
      duplicate,
      invalidEmail,
    };
  });

  return {
    fileName,
    columnOrder,
    rows,
    totalCount: rows.length,
  };
}

const STICKY_TH =
  "sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950 text-zinc-400 shadow-[0_1px_0_0_rgb(39_39_42)]";

export function CsvTable({
  columnOrder,
  rows,
  pageKey,
}: {
  columnOrder: string[];
  rows: CsvPreviewRow[];
  /** Bump when the preview page changes so the body can run a short enter transition */
  pageKey: number;
}) {
  return (
    <Table>
      <TableHeader className="[&_tr]:border-b-0">
        <TableRow className="border-zinc-800 hover:bg-transparent">
          {columnOrder.map((col) => (
            <TableHead key={col} className={cn(STICKY_TH)}>
              {col}
            </TableHead>
          ))}
          <TableHead className={cn(STICKY_TH, "w-[140px] text-right")}>Flags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody
        key={pageKey}
        className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      >
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn(
              "border-zinc-800",
              row.invalidEmail && "bg-red-950/30",
              row.duplicate && !row.invalidEmail && "bg-amber-950/20",
            )}
          >
            {columnOrder.map((col) => (
              <TableCell
                key={col}
                className={cn(
                  "text-sm text-zinc-300",
                  col.trim().toLowerCase() === "email" && "font-mono text-zinc-200",
                )}
              >
                {row.cells[col] || "—"}
              </TableCell>
            ))}
            <TableCell className="text-right">
              <div className="flex flex-wrap justify-end gap-1">
                {row.duplicate && (
                  <Badge variant="secondary" className="border-amber-800/80 bg-amber-950/60 text-amber-200">
                    Duplicate
                  </Badge>
                )}
                {row.invalidEmail && (
                  <Badge variant="destructive" className="text-xs">
                    Invalid email
                  </Badge>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function parseCsvFile(file: File): Promise<Papa.ParseResult<Record<string, string>>> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      /** Auto-detect comma, semicolon (Excel India/EU), tab, etc. */
      delimiter: "",
      encoding: "UTF-8",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      complete: (res) => {
        if (res.data.length === 0 && (!res.meta.fields || res.meta.fields.length === 0)) {
          const detail = res.errors[0]?.message;
          reject(new Error(detail ?? "No headers or rows found"));
          return;
        }
        resolve(res);
      },
      error: (err) => reject(err),
    });
  });
}

function formatCsvParseError(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return (
    `Failed to parse CSV: ${detail}. ` +
    "Use a .csv file (not Excel .xlsx), UTF-8 encoding, first row must include an email column, " +
    "and one row per recipient."
  );
}

/** Set only after a successful parse; used for duplicate detection and cleared when the user removes the file. */
type SuccessfulUploadMeta = {
  fileName: string;
  fileSize: number;
  lastModified: number;
};

function isSameFileMeta(file: File, meta: SuccessfulUploadMeta | null): boolean {
  if (!meta) return false;
  return (
    file.name === meta.fileName &&
    file.size === meta.fileSize &&
    file.lastModified === meta.lastModified
  );
}

async function sha256HexFromFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function CsvRecipientsTab({ onGoToSmtp }: { onGoToSmtp?: () => void }) {
  const {
    campaignRecipients,
    setParsedCsvData,
    clearCampaignRecipients,
    lastParsedCsv,
    builtInMergeTags,
    setBuiltInMergeTags,
  } = useEmailCampaign();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const skipDuplicateCheckOnceRef = React.useRef(false);
  const storageHydrateRef = React.useRef(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [parsing, setParsing] = React.useState(false);
  const [duplicateChecking, setDuplicateChecking] = React.useState(false);
  const [selectedCsvName, setSelectedCsvName] = React.useState<string | null>(null);
  const [csvFileError, setCsvFileError] = React.useState<string | null>(null);
  const [parsedData, setParsedData] = React.useState<ParsedCsv | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [successfulUploadMeta, setSuccessfulUploadMeta] = React.useState<SuccessfulUploadMeta | null>(null);
  const [successfulContentHash, setSuccessfulContentHash] = React.useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = React.useState<{
    file: File;
    reason: "same-file" | "same-content";
  } | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = React.useState(false);
  const [editingBuiltInId, setEditingBuiltInId] = React.useState<BuiltInMergeTagId | null>(null);
  const [tagKeyDraft, setTagKeyDraft] = React.useState("");
  const [tagKeyError, setTagKeyError] = React.useState<string | null>(null);

  const csvColumnKeys = React.useMemo(
    () => parsedData?.columnOrder ?? lastParsedCsv?.columnOrder ?? [],
    [parsedData, lastParsedCsv],
  );

  const builtInPreviewEmail = campaignRecipients[0]?.email ?? "john@example.com";
  const builtInPreviewValues = React.useMemo(
    () => generateBuiltInFieldsForRecipient(builtInPreviewEmail, builtInMergeTags),
    [builtInPreviewEmail, builtInMergeTags],
  );

  const totalPages = React.useMemo(() => {
    if (!parsedData) return 1;
    return Math.max(1, Math.ceil(parsedData.rows.length / ROWS_PER_PAGE));
  }, [parsedData]);

  const previewRows = React.useMemo(() => {
    if (!parsedData) return [];
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    return parsedData.rows.slice(start, start + ROWS_PER_PAGE);
  }, [parsedData, currentPage]);

  // Clamp current page if rows shrink — adjusted during render rather than in
  // an effect to avoid the cascading-render anti-pattern.
  if (parsedData && currentPage > totalPages) {
    setCurrentPage(totalPages);
  }

  React.useEffect(() => {
    setParsedCsvData(parsedData);
  }, [parsedData, setParsedCsvData]);

  // One-time hydration from the parent context's persisted CSV. The values
  // come from localStorage (an external system), so this must run after
  // hydration to avoid SSR/client mismatch — the lint rule's setState-in-
  // effect warning doesn't apply to "sync with external system" effects.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (storageHydrateRef.current) return;
    if (!lastParsedCsv) return;
    if (parsedData) return;
    const csv = lastParsedCsv;
    setParsedData(csv);
    setSelectedCsvName(csv.fileName);
    setCurrentPage(1);
    setCsvFileError(null);
    storageHydrateRef.current = true;
  }, [lastParsedCsv, parsedData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  React.useEffect(() => {
    if (!lastParsedCsv) {
      storageHydrateRef.current = false;
    }
  }, [lastParsedCsv]);

  function clearUploadedFile() {
    setSelectedCsvName(null);
    setParsedData(null);
    setCurrentPage(1);
    setCsvFileError(null);
    setSuccessfulUploadMeta(null);
    setSuccessfulContentHash(null);
    setDuplicatePrompt(null);
    storageHydrateRef.current = false;
    clearCampaignRecipients();
    skipDuplicateCheckOnceRef.current = false;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleGoToSmtp() {
    if (!onGoToSmtp) return;
    if (campaignRecipients.length === 0) {
      toast.error("No valid recipients to send to", {
        description:
          "Add at least one valid, non-duplicate email in your CSV, then try again.",
      });
      return;
    }
    onGoToSmtp();
  }

  async function handleCsvFile(file: File) {
    if (!isLikelyCsv(file)) {
      setCsvFileError("Please choose a CSV file (.csv).");
      setSelectedCsvName(null);
      return;
    }

    setDuplicatePrompt(null);

    const bypassDuplicate = skipDuplicateCheckOnceRef.current;
    if (bypassDuplicate) {
      skipDuplicateCheckOnceRef.current = false;
    } else {
      if (successfulUploadMeta && isSameFileMeta(file, successfulUploadMeta)) {
        setDuplicatePrompt({ file, reason: "same-file" });
        setCsvFileError(null);
        return;
      }
      if (
        successfulContentHash &&
        successfulUploadMeta &&
        file.size === successfulUploadMeta.fileSize &&
        !isSameFileMeta(file, successfulUploadMeta)
      ) {
        setDuplicateChecking(true);
        try {
          const hash = await sha256HexFromFile(file);
          if (hash === successfulContentHash) {
            setDuplicatePrompt({ file, reason: "same-content" });
            setCsvFileError(null);
            return;
          }
        } catch {
          setCsvFileError("Could not verify file for duplicate detection. Try again.");
          return;
        } finally {
          setDuplicateChecking(false);
        }
      }
    }

    setCsvFileError(null);
    setParsing(true);
    setSelectedCsvName(file.name);

    try {
      const res = await parseCsvFile(file);
      const built = buildParsedFromParseResult(file.name, res);
      if ("error" in built) {
        setParsedData(null);
        setCurrentPage(1);
        setCsvFileError(built.error);
        return;
      }
      setParsedData(built);
      setCurrentPage(1);
      setSuccessfulUploadMeta({
        fileName: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
      });
      try {
        setSuccessfulContentHash(await sha256HexFromFile(file));
      } catch {
        setSuccessfulContentHash(null);
      }
    } catch (e) {
      setParsedData(null);
      setCurrentPage(1);
      setCsvFileError(formatCsvParseError(e));
    } finally {
      setParsing(false);
    }
  }

  function openRenameBuiltInTag(tag: BuiltInMergeTagConfig) {
    setEditingBuiltInId(tag.id);
    setTagKeyDraft(tag.key);
    setTagKeyError(null);
    setTagDialogOpen(true);
  }

  function saveBuiltInTagRename() {
    if (!editingBuiltInId) return;
    const rawKey = tagKeyDraft.trim();
    if (!rawKey) {
      setTagKeyError("Enter a tag name.");
      return;
    }
    if (!/^[\w.-]+$/.test(rawKey)) {
      setTagKeyError("Use letters, numbers, _, ., or -.");
      return;
    }
    const lower = rawKey.toLowerCase();
    const csvHasKey = csvColumnKeys.some((c) => c.trim().toLowerCase() === lower);
    if (csvHasKey) {
      setTagKeyError(
        `"${rawKey}" is already a CSV column. Choose a different merge tag name.`,
      );
      return;
    }
    const duplicateBuiltIn = builtInMergeTags.some(
      (t) => t.id !== editingBuiltInId && t.key.toLowerCase() === lower,
    );
    if (duplicateBuiltIn) {
      setTagKeyError("Another built-in tag already uses this name.");
      return;
    }
    setTagKeyError(null);
    setBuiltInMergeTags((prev) =>
      prev.map((t) => (t.id === editingBuiltInId ? { ...t, key: rawKey } : t)),
    );
    setTagDialogOpen(false);
  }

  function openCsvPicker() {
    setCsvFileError(null);
    setDuplicatePrompt(null);
    fileInputRef.current?.click();
  }

  function onCsvInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleCsvFile(file);
    e.target.value = "";
  }

  function onCsvDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleCsvFile(file);
  }

  return (
    <div className="space-y-6">
      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Upload CSV</CardTitle>
          <CardDescription>
            Drag and drop a .csv file here, or click to browse. The first row must be headers, including{" "}
            <code className="text-xs text-zinc-300">email</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            tabIndex={-1}
            onChange={onCsvInputChange}
            aria-label="Choose CSV file"
            disabled={parsing || duplicateChecking}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => !parsing && !duplicateChecking && openCsvPicker()}
            onKeyDown={(e) => {
              if (parsing || duplicateChecking) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openCsvPicker();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              if (!parsing && !duplicateChecking) setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={parsing || duplicateChecking ? undefined : onCsvDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 transition-colors",
              (parsing || duplicateChecking) && "pointer-events-none opacity-70",
              dragActive
                ? "border-emerald-500/60 bg-emerald-950/20"
                : "border-zinc-700 bg-zinc-950/50 hover:border-zinc-500",
            )}
          >
            <div className="flex size-14 items-center justify-center rounded-full bg-zinc-800">
              {parsing || duplicateChecking ? (
                <Loader2 className="size-7 animate-spin text-zinc-300" />
              ) : (
                <Upload className="size-7 text-zinc-300" />
              )}
            </div>
            <div className="text-center">
              <p className="font-medium text-zinc-200">
                {duplicateChecking
                  ? "Checking file…"
                  : parsing
                    ? "Parsing CSV…"
                    : "Drop CSV or click to upload"}
              </p>
              <p className="text-sm text-zinc-500">Accepts .csv with a header row</p>
            </div>
          </div>
          {duplicatePrompt && (
            <div
              role="status"
              className="rounded-lg border border-amber-800/70 bg-amber-950/25 px-3 py-3 text-sm text-amber-100/95"
            >
              <p className="font-medium text-amber-50">
                {duplicatePrompt.reason === "same-file"
                  ? "This file has already been uploaded."
                  : "Duplicate file detected. This file matches the content of your current upload."}
              </p>
              <p className="mt-1 text-xs text-amber-200/85">
                {duplicatePrompt.reason === "same-file"
                  ? "It has the same name, size, and modified time as the CSV already loaded. Upload a different file, or use Upload anyway to reprocess."
                  : "The file name differs, but the contents are identical. Use a different file, or upload again if you meant to replace the data."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-amber-800/60 bg-transparent text-amber-100 hover:bg-amber-950/40"
                  onClick={() => setDuplicatePrompt(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="border-zinc-600 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                  onClick={() => {
                    const f = duplicatePrompt.file;
                    skipDuplicateCheckOnceRef.current = true;
                    setDuplicatePrompt(null);
                    void handleCsvFile(f);
                  }}
                >
                  Upload anyway
                </Button>
              </div>
            </div>
          )}
          {selectedCsvName && !parsing && !duplicateChecking && (
            <div className="flex items-center justify-center gap-1 text-sm text-emerald-400/90">
              <span>
                File: <span className="font-mono">{selectedCsvName}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={(e) => {
                  e.stopPropagation();
                  clearUploadedFile();
                }}
                aria-label="Remove uploaded file and clear preview"
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
          {csvFileError && (
            <p className="text-center text-sm text-red-400" role="alert">
              {csvFileError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader className="flex flex-row items-start gap-3">
          <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-zinc-500" />
          <div>
            <CardTitle className="text-zinc-100">Merge tags</CardTitle>
            <CardDescription>
              CSV columns appear after upload. Four built-in tags are always available — unique random
              values per recipient (date uses today, mm/dd/yyyy). You may rename built-in tag keys only.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {csvColumnKeys.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">From CSV</p>
              <ul className="space-y-2">
                {csvColumnKeys.map((col) => (
                  <li
                    key={`csv-${col}`}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                  >
                    <code className="font-mono text-sm text-emerald-400/90">{mergeTagDisplay(col)}</code>
                    <p className="text-xs text-zinc-500">One value per recipient row</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-700 py-6 text-center text-sm text-zinc-500">
              Upload a CSV to load column merge tags from headers.
            </p>
          )}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Built-in (always on)</p>
            <ul className="space-y-2">
              {builtInMergeTags.map((tag) => (
                <li
                  key={tag.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <code className="font-mono text-sm text-emerald-400/90">{mergeTagDisplay(tag.key)}</code>
                    <p className="text-xs text-zinc-500">
                      {builtInTagLabel(tag.id)}
                      {builtInPreviewValues[tag.key] ? (
                        <>
                          {" "}
                          · sample{" "}
                          <span className="font-mono text-zinc-300">{builtInPreviewValues[tag.key]}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    aria-label={`Rename tag ${tag.key}`}
                    onClick={() => openRenameBuiltInTag(tag)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename built-in tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="merge-tag-key">Tag name (inside {"{{{ }}}"} )</Label>
            <Input
              id="merge-tag-key"
              value={tagKeyDraft}
              onChange={(e) => {
                setTagKeyDraft(e.target.value);
                setTagKeyError(null);
              }}
              placeholder="e.g. invoice_number"
              autoComplete="off"
              className="bg-zinc-900 font-mono"
            />
            <p className="text-xs text-zinc-500">
              Renders as{" "}
              <span className="font-mono text-emerald-500/90">{mergeTagDisplay(tagKeyDraft.trim() || "tag")}</span>
              . Values are generated automatically per recipient; you cannot edit them here.
            </p>
            {tagKeyError && <p className="text-sm text-red-400">{tagKeyError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setTagDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveBuiltInTagRename}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {parsedData && (
        <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
          <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-zinc-100">Preview</CardTitle>
              <CardDescription>
                Parsed rows from <span className="font-mono text-zinc-400">{parsedData.fileName}</span>. Invalid and
                duplicate emails are flagged. {ROWS_PER_PAGE} rows per page — no scroll.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              <span className="tabular-nums text-sm text-zinc-400">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-zinc-700"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-zinc-700"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-400">
              <span className="font-medium text-zinc-200">{parsedData.totalCount}</span> record
              {parsedData.totalCount === 1 ? "" : "s"} parsed
              {parsedData.totalCount > 0 ? (
                <>
                  {" "}
                  · showing{" "}
                  {Math.min(ROWS_PER_PAGE, previewRows.length) > 0
                    ? `${(currentPage - 1) * ROWS_PER_PAGE + 1}–${(currentPage - 1) * ROWS_PER_PAGE + previewRows.length}`
                    : "0"}
                  {" of "}
                  {parsedData.totalCount}
                </>
              ) : null}
            </p>
            {parsedData.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-700 py-8 text-center text-sm text-zinc-500">
                No data rows after the header row.
              </p>
            ) : (
              <CsvTable
                columnOrder={parsedData.columnOrder}
                rows={previewRows}
                pageKey={currentPage}
              />
            )}
            {onGoToSmtp && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-800 pt-4">
                <p className="me-auto text-xs text-zinc-500">
                  Data is saved for this session. It stays until you remove the file above.
                </p>
                <Button
                  type="button"
                  onClick={handleGoToSmtp}
                  className="min-w-[7rem] bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  Next
                  <ChevronRight className="ms-1 size-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
