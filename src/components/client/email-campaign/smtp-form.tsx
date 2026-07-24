"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Mail, Send, Server, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setLastBulkImportedSmtpIds } from "@/lib/bulk-smtp-session";
import {
  DUPLICATE_SMTP_MESSAGE,
  smtpIdentityKey,
} from "@/lib/smtp-identity";
import { isMailercloudSmtpHost, isResendSmtpHost, isSesSmtpHost } from "@/lib/smtp/from-address";
import { cn } from "@/lib/utils";
import { ServerIpPanel } from "./server-ip-panel";
import {
  deleteSmtpServer,
  fetchSmtpPlanCapacity,
  importBulkSmtpServers,
  listSmtpServers,
  saveSmtpServer,
  sendSmtpTestEmail,
  sendTestEmailFromSaved,
  testSmtpConnection,
  type SavedSmtpRow,
  type SmtpFormInput,
  type SmtpProvider,
} from "@/app/actions/smtp";
import { toastOptimisticRollback } from "@/lib/optimistic-ui";
import { getServerIpAction, type ServerIpSnapshot } from "@/app/actions/server-ip";
import type { SmtpPlanCapacity } from "@/lib/smtp-plan-limit";
import { useWalletState } from "./wallet-state-context";

type PresetId = "gmail" | "yahoo" | "outlook";

type PresetDef = {
  id: PresetId;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  hint: string;
  /** Provider-specific guide (shown once the preset is selected). */
  appPasswordHelp: { url: string; text: string };
};

const PRESETS: readonly PresetDef[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: true,
    hint: "smtp.gmail.com · 587 · STARTTLS",
    appPasswordHelp: {
      url: "https://myaccount.google.com/apppasswords",
      text:
        "Gmail requires an App Password. Enable 2-Step Verification on your Google account, " +
        "then generate a 16-character App Password and paste it below — not your regular Gmail password.",
    },
  },
  {
    id: "yahoo",
    label: "Yahoo",
    host: "smtp.mail.yahoo.com",
    port: 587,
    secure: true,
    hint: "smtp.mail.yahoo.com · 587 · STARTTLS",
    appPasswordHelp: {
      url: "https://login.yahoo.com/account/security",
      text:
        "Yahoo requires an App Password. In Account Security, turn on 2-Step Verification, then generate an App Password and paste it below.",
    },
  },
  {
    id: "outlook",
    label: "Outlook",
    host: "smtp.office365.com",
    port: 587,
    secure: true,
    hint: "smtp.office365.com · 587 · STARTTLS",
    appPasswordHelp: {
      url: "https://account.microsoft.com/security",
      text:
        "Outlook / Microsoft 365 accounts with 2FA need an App Password (Security → Advanced → App passwords). Paste that below instead of your normal password.",
    },
  },
] as const;

function findPreset(id: string | null): PresetDef | null {
  if (!id) return null;
  return PRESETS.find((p) => p.id === id) ?? null;
}

/** Guess Gmail / Yahoo / Outlook SMTP preset from the address domain (bulk CSV can mix providers). */
function inferPresetFromEmail(email: string): PresetDef | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return null;

  if (domain === "gmail.com" || domain === "googlemail.com") {
    return findPreset("gmail");
  }
  if (
    domain === "yahoo.com" ||
    domain === "ymail.com" ||
    domain === "yahoo.co.uk" ||
    domain === "rocketmail.com"
  ) {
    return findPreset("yahoo");
  }
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain === "msn.com"
  ) {
    return findPreset("outlook");
  }
  if (domain.endsWith(".onmicrosoft.com")) {
    return findPreset("outlook");
  }
  return null;
}

const BULK_PAGE_SIZE = 10;

type BulkSmtpFormat = "simple" | "advanced";

type BulkSmtpRow = {
  id: string;
  lineNo: number;
  raw: string;
  format: BulkSmtpFormat | null;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  invalid?: boolean;
  reason?: string;
  /** Already saved or repeated in the same file — not imported. */
  duplicate?: boolean;
  duplicateReason?: string;
};

type BulkSmtpParseResult = {
  rows: BulkSmtpRow[];
  format: BulkSmtpFormat | null;
  invalidCount: number;
};

function isLikelyHeaderLine(line: string): boolean {
  const lower = line.trim().toLowerCase();
  if (/^(email|user(name)?|login)[,:]/.test(lower)) return true;
  if (/^(host|server)[,:]/.test(lower)) return true;
  return false;
}

function parseAdvancedLine(line: string): Omit<BulkSmtpRow, "id" | "lineNo" | "raw"> | null {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 4) return null;
  const [host, port, username, ...passParts] = parts;
  if (!host || !port || !username || passParts.length === 0) return null;
  if (!/^\d+$/.test(port)) return null;
  const password = passParts.join(",");
  if (!password) return null;
  return { format: "advanced", host, port, username, password };
}

/** `user:pass` — preset supplies SMTP host/port. */
function parseSimpleLine(line: string): Omit<BulkSmtpRow, "id" | "lineNo" | "raw"> | null {
  const idx = line.indexOf(":");
  if (idx <= 0 || idx === line.length - 1) return null;
  const username = line.slice(0, idx).trim();
  const password = line.slice(idx + 1).trim();
  if (!username || !password) return null;
  return { format: "simple", username, password };
}

/**
 * CSV-style `email,app-password` (first comma only so Gmail 16-char app passwords
 * with spaces stay intact). Requires `@` in the email part.
 */
function parseCsvSimpleLine(line: string): Omit<BulkSmtpRow, "id" | "lineNo" | "raw"> | null {
  const idx = line.indexOf(",");
  if (idx <= 0 || idx === line.length - 1) return null;
  const username = line.slice(0, idx).trim();
  const password = line.slice(idx + 1).trim();
  if (!username || !password || !username.includes("@")) return null;
  return { format: "simple", username, password };
}

function parseBulkSmtpText(text: string): BulkSmtpParseResult {
  const lines = text.split(/\r?\n/);
  const rows: BulkSmtpRow[] = [];
  let advancedCount = 0;
  let simpleCount = 0;

  lines.forEach((original, i) => {
    const trimmed = original.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) return;
    if (isLikelyHeaderLine(trimmed)) return;

    const id = `line-${i + 1}`;
    const lineNo = i + 1;

    const advanced = parseAdvancedLine(trimmed);
    if (advanced) {
      advancedCount++;
      rows.push({ id, lineNo, raw: trimmed, ...advanced });
      return;
    }
    const simple = parseSimpleLine(trimmed) ?? parseCsvSimpleLine(trimmed);
    if (simple) {
      simpleCount++;
      rows.push({ id, lineNo, raw: trimmed, ...simple });
      return;
    }
    rows.push({
      id,
      lineNo,
      raw: trimmed,
      format: null,
      invalid: true,
      reason: "Expected email:pass, email,pass, or host,port,user,pass",
    });
  });

  const format: BulkSmtpFormat | null =
    advancedCount === 0 && simpleCount === 0
      ? null
      : advancedCount >= simpleCount
        ? "advanced"
        : "simple";

  const invalidCount = rows.filter((r) => r.invalid).length;
  return { rows, format, invalidCount };
}

type SmtpBulkFileItem = {
  key: string;
  file: File;
  parsed: BulkSmtpParseResult;
};

function smtpFileKey(f: File) {
  return `${f.name}-${f.size}-${f.lastModified}`;
}

function bulkRowToSmtpInput(
  row: BulkSmtpRow,
  manualPreset: PresetDef | null,
): SmtpFormInput | null {
  if (row.invalid || !row.format) return null;
  if (row.format === "advanced") {
    const port = parseInt(String(row.port ?? ""), 10);
    if (!Number.isFinite(port) || port <= 0) return null;
    const host = String(row.host ?? "").trim();
    const username = String(row.username ?? "").trim();
    if (!host || !username) return null;
    const usesImplicitTls = port === 465;
    return {
      host,
      port,
      secure: usesImplicitTls,
      username,
      password: String(row.password ?? ""),
      provider: "custom",
      label: username.slice(0, 80),
    };
  }
  const username = String(row.username ?? "").trim();
  if (!username) return null;
  const preset = inferPresetFromEmail(username) ?? manualPreset;
  if (!preset) return null;
  return {
    host: preset.host,
    port: preset.port,
    secure: preset.secure,
    username,
    password: String(row.password ?? ""),
    provider: preset.id,
    label: `${preset.label} — ${username}`.slice(0, 80),
  };
}

function mergeBulkPreviews(items: SmtpBulkFileItem[]): {
  rows: BulkSmtpRow[];
  format: BulkSmtpFormat | null;
  invalidCount: number;
  sourceNames: string[];
} {
  const sourceNames = items.map((i) => i.file.name);
  let advancedCount = 0;
  let simpleCount = 0;
  for (const item of items) {
    for (const r of item.parsed.rows) {
      if (r.format === "advanced") advancedCount++;
      else if (r.format === "simple") simpleCount++;
    }
  }
  const format: BulkSmtpFormat | null =
    advancedCount === 0 && simpleCount === 0
      ? null
      : advancedCount >= simpleCount
        ? "advanced"
        : "simple";

  const allRows: BulkSmtpRow[] = [];
  let lineCounter = 0;
  for (const item of items) {
    for (const r of item.parsed.rows) {
      lineCounter++;
      allRows.push({
        ...r,
        id: `${item.key}-${r.id}`,
        lineNo: lineCounter,
      });
    }
  }
  const invalidCount = allRows.filter((r) => r.invalid).length;
  return { rows: allRows, format, invalidCount, sourceNames };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

export function SmtpForm({
  previewMode = false,
  onGoToComposer,
}: {
  previewMode?: boolean;
  onGoToComposer?: () => void;
}) {
  const { state: walletState } = useWalletState();
  const [planCapacity, setPlanCapacity] = React.useState<SmtpPlanCapacity | null>(null);
  const [ipSnapshot, setIpSnapshot] = React.useState<ServerIpSnapshot | null>(null);

  const refreshPlanCapacity = React.useCallback(async () => {
    if (previewMode) return;
    const [capRes, ipRes] = await Promise.all([
      fetchSmtpPlanCapacity(),
      getServerIpAction(),
    ]);
    if (capRes.ok && capRes.data) setPlanCapacity(capRes.data);
    if (ipRes.ok && ipRes.data) setIpSnapshot(ipRes.data);
  }, [previewMode]);

  const handleIpSnapshotChange = React.useCallback((snapshot: ServerIpSnapshot) => {
    setIpSnapshot(snapshot);
  }, []);

  const [nexting, setNexting] = React.useState(false);
  const [preset, setPreset] = React.useState<PresetId | null>(null);
  const [smtpHost, setSmtpHost] = React.useState("");
  const [smtpPort, setSmtpPort] = React.useState("");
  const [smtpUsername, setSmtpUsername] = React.useState("");
  const [smtpPassword, setSmtpPassword] = React.useState("");
  const [smtpLabel, setSmtpLabel] = React.useState("");
  const [secure, setSecure] = React.useState(true);
  const [rotation, setRotation] = React.useState("round-robin");

  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [sendingTest, setSendingTest] = React.useState(false);

  const [savedRows, setSavedRows] = React.useState<SavedSmtpRow[]>([]);
  const [savedLoading, setSavedLoading] = React.useState(false);
  const [savedError, setSavedError] = React.useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = React.useState<string | null>(null);

  const refreshSaved = React.useCallback(async () => {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const res = await listSmtpServers();
      if (res.ok) {
        setSavedRows(res.data ?? []);
      } else {
        setSavedError(res.error);
      }
      await refreshPlanCapacity();
    } finally {
      setSavedLoading(false);
    }
  }, [refreshPlanCapacity]);

  // Initial async fetch of saved SMTP servers — setState happens after await.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSaved();
  }, [refreshSaved]);

  const isLocalPostfix =
    (smtpHost.trim() === "127.0.0.1" ||
      smtpHost.trim().toLowerCase() === "localhost") &&
    smtpPort.trim() === "25";

  React.useEffect(() => {
    if (isLocalPostfix && secure) setSecure(false);
  }, [isLocalPostfix, secure]);

  async function handleNextToComposer() {
    if (previewMode) {
      toast.message("Sign in to continue.");
      return;
    }
    if (!onGoToComposer) {
      return;
    }
    const missing = requireFilled();
    if (missing == null) {
      setNexting(true);
      const res = await saveSmtpServer(currentInput());
      setNexting(false);
      if (res.ok) {
        toast.success("SMTP saved.", {
          description: "Opening Email Composer.",
        });
        setSmtpPassword("");
        await refreshSaved();
        onGoToComposer();
      } else {
        toast.error("Could not save SMTP.", { description: res.error });
      }
      return;
    }
    if (savedRows.length > 0) {
      onGoToComposer();
      return;
    }
    toast.error("Finish SMTP setup", { description: missing });
  }

  const activePreset = findPreset(preset);

  function applyPreset(id: PresetId) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setSmtpHost(p.host);
    setSmtpPort(String(p.port));
    setSecure(p.secure);
    if (!smtpLabel.trim()) setSmtpLabel(p.label);
  }

  function applySesDefaults() {
    setPreset(null);
    setSmtpLabel("BulkFire Pro SES");
    setSmtpHost("email-smtp.ap-south-1.amazonaws.com");
    setSmtpPort("587");
    setSmtpUsername("");
    setSmtpPassword("");
    setSecure(true);
    toast.message("SES fields filled", {
      description: "Paste SMTP username (AKIA…) and password from AWS SES → SMTP settings.",
    });
  }

  function applyLocalPostfixDefaults() {
    setPreset(null);
    setSmtpLabel("BulkFire Pro");
    setSmtpHost("127.0.0.1");
    setSmtpPort("25");
    setSmtpUsername("noreply@bulkfirepro.com");
    setSmtpPassword("local");
    setSecure(false);
    toast.message("Local Postfix defaults filled", {
      description: "Test SMTP → Save. Password is not used for 127.0.0.1:25.",
    });
  }

  function currentInput(): {
    host: string;
    port: string;
    secure: boolean;
    username: string;
    password: string;
    label: string | null;
    provider: SmtpProvider;
  } {
    return {
      host: smtpHost.trim(),
      port: smtpPort.trim(),
      secure,
      username: smtpUsername.trim(),
      password: smtpPassword,
      label: smtpLabel.trim() || null,
      provider: (preset ?? "custom") as SmtpProvider,
    };
  }

  function requireFilled(): string | null {
    const i = currentInput();
    if (!i.host) return "Host is required. Click a preset or enter one manually.";
    if (!i.port) return "Port is required.";
    if (!i.username) return "Username (your email) is required.";
    if (!i.password) return "Password (App Password for Gmail/Yahoo/Outlook) is required.";
    return null;
  }

  async function onTest() {
    const missing = requireFilled();
    if (missing) {
      toast.error(missing);
      return;
    }
    setTesting(true);
    const res = await testSmtpConnection(currentInput());
    setTesting(false);
    if (res.ok) {
      toast.success("SMTP verified.", {
        description: `${smtpHost}:${smtpPort} accepted the credentials.`,
      });
    } else {
      toast.error("SMTP test failed.", { description: res.error });
    }
  }

  async function onSendTestEmail() {
    const missing = requireFilled();
    if (missing) {
      toast.error(missing);
      return;
    }
    setSendingTest(true);
    const res = await sendSmtpTestEmail({ ...currentInput() });
    setSendingTest(false);
    if (res.ok) {
      const who = res.data?.accepted?.[0] ?? "your inbox";
      toast.success("Test email sent.", { description: `Delivered to ${who}.` });
    } else {
      toast.error("Could not send test email.", { description: res.error });
    }
  }

  async function onSave() {
    const missing = requireFilled();
    if (missing) {
      toast.error(missing);
      return;
    }
    const input = currentInput();
    const pendingId = `pending-${Date.now()}`;
    const optimisticRow: SavedSmtpRow = {
      id: pendingId,
      label: input.label ?? `${input.provider} — ${input.username}`,
      provider: input.provider ?? "custom",
      host: input.host,
      port: Number(input.port),
      username: input.username,
      secure: input.secure,
      created_at: new Date().toISOString(),
    };
    const previousRows = savedRows;
    setSavedRows((rows) => [optimisticRow, ...rows]);
    setSaving(true);
    const res = await saveSmtpServer(input);
    setSaving(false);
    if (res.ok && res.data) {
      setSavedRows((rows) =>
        rows.map((r) => (r.id === pendingId ? res.data! : r)),
      );
      toast.success("SMTP saved.", {
        description: "Credentials encrypted at rest. Ready to use in campaigns.",
      });
      setSmtpPassword("");
      void refreshPlanCapacity();
    } else {
      setSavedRows(previousRows);
      toastOptimisticRollback("Save SMTP", res.ok ? undefined : res.error);
    }
  }

  async function onDeleteSaved(id: string, label: string | null) {
    if (typeof window !== "undefined") {
      const name = label || "this SMTP";
      if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    }
    const previousRows = savedRows;
    setSavedRows((rows) => rows.filter((r) => r.id !== id));
    setRowBusyId(id);
    const res = await deleteSmtpServer(id);
    setRowBusyId(null);
    if (res.ok) {
      toast.success("SMTP deleted.");
      void refreshPlanCapacity();
    } else {
      setSavedRows(previousRows);
      toastOptimisticRollback("Delete SMTP", res.error);
    }
  }

  async function onSendTestFromSaved(id: string) {
    setRowBusyId(id);
    const res = await sendTestEmailFromSaved({ id });
    setRowBusyId(null);
    if (res.ok) {
      const who = res.data?.accepted?.[0] ?? "your inbox";
      toast.success("Test email sent.", { description: `Delivered to ${who}.` });
    } else {
      toast.error("Could not send test email.", { description: res.error });
    }
  }

  // --- Bulk SMTP upload: parse in browser; import persists via importBulkSmtpServers.
  const [smtpFiles, setSmtpFiles] = React.useState<SmtpBulkFileItem[]>([]);
  const [bulkFileError, setBulkFileError] = React.useState<string | null>(null);
  const [bulkPage, setBulkPage] = React.useState(1);
  const [bulkImporting, setBulkImporting] = React.useState(false);
  const bulkUploadRef = React.useRef<HTMLInputElement>(null);
  const smtpFilesPrevLen = React.useRef(0);

  const mergedBulk = React.useMemo(() => mergeBulkPreviews(smtpFiles), [smtpFiles]);
  const bulkRowsRaw = mergedBulk.rows;
  const bulkFormat = mergedBulk.format;
  const bulkSourceNames = mergedBulk.sourceNames;

  const bulkRows = React.useMemo(() => {
    const existing = new Set(
      savedRows.map((r) => smtpIdentityKey(r.host, r.port, r.username)),
    );
    const fileSeen = new Set<string>();
    return bulkRowsRaw.map((row) => {
      if (row.invalid) return row;
      const input = bulkRowToSmtpInput(row, activePreset);
      if (!input) return row;
      const key = smtpIdentityKey(input.host, input.port, input.username);
      if (existing.has(key)) {
        return {
          ...row,
          duplicate: true,
          duplicateReason: DUPLICATE_SMTP_MESSAGE,
        };
      }
      if (fileSeen.has(key)) {
        return {
          ...row,
          duplicate: true,
          duplicateReason: "Duplicate line in this import file.",
        };
      }
      fileSeen.add(key);
      return row;
    });
  }, [bulkRowsRaw, savedRows, activePreset]);

  const bulkInvalidCount = bulkRows.filter((r) => r.invalid).length;
  const bulkDuplicateCount = bulkRows.filter((r) => r.duplicate).length;
  const bulkValidCount = bulkRows.filter((r) => !r.invalid && !r.duplicate).length;

  const bulkTotalPages = Math.max(1, Math.ceil(bulkRows.length / BULK_PAGE_SIZE));
  const bulkPageRows = React.useMemo(
    () => bulkRows.slice((bulkPage - 1) * BULK_PAGE_SIZE, bulkPage * BULK_PAGE_SIZE),
    [bulkRows, bulkPage],
  );
  const bulkStart = bulkRows.length === 0 ? 0 : (bulkPage - 1) * BULK_PAGE_SIZE + 1;
  const bulkEnd = Math.min(bulkPage * BULK_PAGE_SIZE, bulkRows.length);

  // Clamp bulk page if rows shrink — adjusted during render to avoid the
  // cascading re-render that setState-in-effect would cause.
  const bulkClampedTotal = Math.max(1, Math.ceil(bulkRows.length / BULK_PAGE_SIZE));
  if (bulkPage > bulkClampedTotal) {
    setBulkPage(bulkClampedTotal);
  }

  React.useEffect(() => {
    if (smtpFiles.length > smtpFilesPrevLen.current) {
      setBulkPage(1);
    }
    smtpFilesPrevLen.current = smtpFiles.length;
  }, [smtpFiles.length]);

  async function processBulkSmtpPicked(picked: File[]) {
    if (!picked.length) return;
    setBulkFileError(null);

    const errors: string[] = [];
    const newItems: SmtpBulkFileItem[] = [];
    const batchKeys = new Set<string>();

    for (const file of picked) {
      const k = smtpFileKey(file);
      if (batchKeys.has(k)) continue;
      batchKeys.add(k);

      if (file.size === 0) {
        errors.push(`${file.name} is empty`);
        continue;
      }
      try {
        const text = await readFileAsText(file);
        if (!text.trim()) {
          errors.push(`${file.name} is empty`);
          continue;
        }
        const parsed = parseBulkSmtpText(text);
        if (parsed.rows.length === 0) {
          errors.push(`${file.name}: no usable lines`);
          continue;
        }
        newItems.push({ key: k, file, parsed });
      } catch {
        errors.push(`${file.name}: could not read`);
      }
    }

    if (newItems.length) {
      setSmtpFiles((prev) => {
        const keys = new Set(prev.map((x) => x.key));
        const next = [...prev];
        for (const item of newItems) {
          if (!keys.has(item.key)) {
            keys.add(item.key);
            next.push(item);
          }
        }
        return next;
      });
    }

    if (errors.length) {
      setBulkFileError(errors.join("; "));
    } else if (newItems.length === 0 && picked.length > 0) {
      setBulkFileError(
        "No new files added (duplicates or invalid). Expected `email:pass`, `email,pass`, or `host,port,user,pass` per line.",
      );
    }
  }

  function onBulkSmtpFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (picked.length === 0) return;
    void processBulkSmtpPicked(picked);
  }

  function removeSmtpFileAt(index: number) {
    setBulkFileError(null);
    setSmtpFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0 && bulkUploadRef.current) {
        bulkUploadRef.current.value = "";
      }
      return next;
    });
  }

  async function handleBulkImport() {
    if (previewMode) {
      toast.message("Sign in to import SMTP servers.");
      return;
    }
    const unresolvedLines: number[] = [];
    for (const row of bulkRows) {
      if (row.invalid || row.format !== "simple") continue;
      const u = String(row.username ?? "").trim();
      if (!inferPresetFromEmail(u) && !activePreset) {
        unresolvedLines.push(row.lineNo);
      }
    }
    if (unresolvedLines.length > 0) {
      toast.error("Some rows need a preset or full SMTP line", {
        description:
          `We auto-detect Gmail, Yahoo, and Outlook from the email domain. For other domains, click a provider preset above, or use host,port,user,pass per line. Problem rows: ${unresolvedLines.slice(0, 8).join(", ")}${unresolvedLines.length > 8 ? "…" : ""}`,
      });
      return;
    }
    const inputs: SmtpFormInput[] = [];
    for (const row of bulkRows) {
      if (row.invalid || row.duplicate) continue;
      const input = bulkRowToSmtpInput(row, activePreset);
      if (input) inputs.push(input);
    }
    if (inputs.length === 0) {
      toast.error("Nothing to import", {
        description: "Fix invalid rows or add a file with valid lines.",
      });
      return;
    }
    setBulkImporting(true);
    try {
      const res = await importBulkSmtpServers(inputs);
      if (!res.ok) {
        toast.error("Import failed", { description: res.error });
        return;
      }
      const { imported, failed, skippedDuplicates, insertedIds } = res.data!;
      if (insertedIds.length > 0) {
        setLastBulkImportedSmtpIds(insertedIds);
      }
      const skipped = skippedDuplicates.length;
      if (imported === 0 && skipped > 0 && failed.length === 0) {
        toast.message("No new SMTP servers imported", {
          description: `${skipped} duplicate(s) skipped — already in Saved SMTP servers.`,
        });
      } else if (failed.length || skipped > 0) {
        const parts: string[] = [];
        if (imported > 0) parts.push(`${imported} imported`);
        if (skipped > 0) parts.push(`${skipped} duplicate(s) skipped`);
        if (failed.length > 0) parts.push(`${failed.length} failed`);
        toast.message(parts.join(", "), {
          description:
            skipped > 0
              ? "Duplicates were not inserted. Use existing servers or remove them from Saved SMTP first."
              : failed
                  .slice(0, 3)
                  .map((f) => `row ${f.index + 1}: ${f.error}`)
                  .join(" · "),
        });
      } else {
        toast.success(`Imported ${imported} SMTP server(s).`, {
          description:
            "They appear in Saved SMTP below. The next campaign send will rotate through only this batch until you import another file.",
        });
      }
      await refreshSaved();
      setSmtpFiles([]);
      setBulkFileError(null);
      if (bulkUploadRef.current) bulkUploadRef.current.value = "";
    } finally {
      setBulkImporting(false);
    }
  }

  React.useEffect(() => {
    void refreshPlanCapacity();
  }, [refreshPlanCapacity, walletState.activePlan]);

  const smtpSlotsUsed = Math.max(planCapacity?.current ?? 0, savedRows.length);
  const smtpSlotsLimit = planCapacity?.limit ?? null;
  const sendIpSlotIndex = ipSnapshot?.sendPoolIndex ?? null;
  const sendIpPoolSize = ipSnapshot?.sendPoolSize ?? smtpSlotsLimit;

  const planSlotsLabel =
    planCapacity == null
      ? null
      : smtpSlotsLimit === null
        ? `${smtpSlotsUsed} saved · unlimited plan slots`
        : `${smtpSlotsUsed} / ${smtpSlotsLimit} SMTP accounts saved`;

  const atPlanSlotLimit =
    smtpSlotsLimit !== null &&
    planCapacity != null &&
    planCapacity.hasActivePlan &&
    smtpSlotsUsed >= smtpSlotsLimit;

  return (
    <div className="space-y-6">
      {planCapacity && !previewMode && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            !planCapacity.hasActivePlan
              ? "border-amber-700/50 bg-amber-950/30 text-amber-100"
              : atPlanSlotLimit
                ? "border-amber-700/50 bg-amber-950/30 text-amber-100"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-300",
          )}
        >
          <p className="font-medium text-zinc-100">Server plan slots</p>
          <p className="mt-1 text-xs leading-relaxed">
            {!planCapacity.hasActivePlan
              ? "Activate a server plan under Wallet & Plan before adding SMTP servers."
              : smtpSlotsLimit === null
                ? "Unlimited SMTP servers on your active plan."
                : `${smtpSlotsUsed} of ${smtpSlotsLimit} SMTP accounts saved on your active plan.`}
            {planSlotsLabel ? ` · ${planSlotsLabel}` : ""}
          </p>
          {planCapacity.hasActivePlan &&
          sendIpPoolSize != null &&
          sendIpSlotIndex != null ? (
            <p className="mt-1 text-xs text-zinc-400">
              Active send IP slot:{" "}
              <span className="font-mono text-zinc-300">
                {sendIpSlotIndex} of {sendIpPoolSize}
              </span>
              {" · "}
              updates when you click Refresh below
            </p>
          ) : null}
          {!planCapacity.hasActivePlan && (
            <p className="mt-1 text-xs text-amber-200/90">
              Activate a plan under Wallet & Plan before importing SMTP servers.
            </p>
          )}
        </div>
      )}
      <ServerIpPanel previewMode={previewMode} onSnapshotChange={handleIpSnapshotChange} />

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            <Mail className="size-5 text-zinc-400" />
            Preset providers
          </CardTitle>
          <CardDescription>
            Click a provider to auto-fill the host, port and TLS settings below. Then enter your
            email + App Password and hit <span className="text-zinc-300">Test SMTP</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={cn(
                  "rounded-xl border px-4 py-4 text-left text-sm transition-colors",
                  preset === p.id
                    ? "border-emerald-600/80 bg-emerald-950/30 text-zinc-100"
                    : "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:border-zinc-600",
                )}
              >
                <span className="block font-semibold">{p.label}</span>
                <span className="mt-1 block text-xs text-zinc-500">{p.hint}</span>
              </button>
            ))}
          </div>
          {activePreset && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-200/90">
              <p className="font-medium text-amber-200">{activePreset.label} — App Password required</p>
              <p className="mt-1 text-amber-200/80">{activePreset.appPasswordHelp.text}</p>
              <a
                href={activePreset.appPasswordHelp.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-block font-medium text-amber-200 underline decoration-amber-500/40 underline-offset-2 hover:text-amber-100"
              >
                Open the {activePreset.label} App Password page →
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            <Server className="size-5 text-zinc-400" />
            {activePreset ? `${activePreset.label} SMTP` : "Custom SMTP"}
          </CardTitle>
          <CardDescription>
            Host, port and credentials. Click <span className="text-zinc-300">Test SMTP</span> to
            verify — nothing is persisted until you press <span className="text-zinc-300">Save</span>.
          </CardDescription>
          {!activePreset ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-emerald-700/50 text-emerald-200"
                onClick={applySesDefaults}
              >
                Use Amazon SES (bulkfirepro.com)
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-600 text-zinc-300"
                onClick={applyLocalPostfixDefaults}
              >
                Use VPS Postfix (127.0.0.1)
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="smtp-label">Label (optional)</Label>
              <Input
                id="smtp-label"
                type="text"
                autoComplete="off"
                placeholder={
                  activePreset ? `${activePreset.label} – work` : "My main Gmail"
                }
                className="bg-zinc-950/50"
                value={smtpLabel}
                onChange={(e) => setSmtpLabel(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-host">Host</Label>
              <Input
                id="smtp-host"
                type="text"
                autoComplete="off"
                placeholder="smtp.example.com"
                className="bg-zinc-950/50"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="587"
                className="bg-zinc-950/50"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-user">
                {isSesSmtpHost(smtpHost)
                  ? "SMTP username (from AWS SES)"
                  : isResendSmtpHost(smtpHost)
                    ? "SMTP username (Resend)"
                    : "Username (email)"}
              </Label>
              <Input
                id="smtp-user"
                type={
                  isSesSmtpHost(smtpHost) || isResendSmtpHost(smtpHost)
                    ? "text"
                    : "email"
                }
                autoComplete="username"
                placeholder={
                  isSesSmtpHost(smtpHost)
                    ? "AKIA… (SES SMTP credentials)"
                    : isResendSmtpHost(smtpHost)
                      ? "resend"
                      : activePreset?.id === "gmail"
                        ? "you@gmail.com"
                        : "you@example.com"
                }
                className="bg-zinc-950/50 font-mono"
                value={smtpUsername}
                onChange={(e) => setSmtpUsername(e.target.value)}
              />
              {isSesSmtpHost(smtpHost) ? (
                <p className="text-xs text-zinc-500">
                  Paste the <strong>SMTP username</strong> from AWS (starts with AKIA). Campaigns
                  send From <strong>noreply@bulkfirepro.com</strong> automatically when{" "}
                  <code className="text-emerald-400">DKIM_DOMAIN=bulkfirepro.com</code> is set on the
                  server.
                </p>
              ) : null}
              {isResendSmtpHost(smtpHost) ? (
                <p className="text-xs text-zinc-500">
                  Username must be exactly <code className="text-emerald-400">resend</code>. Password
                  is your Resend API key (<code className="text-emerald-400">re_…</code>). From
                  becomes <strong>noreply@bulkfirepro.com</strong> when{" "}
                  <code className="text-emerald-400">DKIM_DOMAIN=bulkfirepro.com</code> is set on the
                  server. Use port <strong>465</strong> with Secure <strong>ON</strong>.
                </p>
              ) : null}
              {isMailercloudSmtpHost(smtpHost) ? (
                <p className="text-xs text-zinc-500">
                  SMTP username can be your Mailercloud login email. Campaigns send From{" "}
                  <strong>noreply@bulkfirepro.com</strong> when{" "}
                  <code className="text-emerald-400">DKIM_DOMAIN=bulkfirepro.com</code> is set.
                  Authenticate <code className="text-emerald-400">bulkfirepro.com</code> and add that
                  address under <strong>Sender management</strong> in Mailercloud. Port{" "}
                  <strong>587</strong>, Secure <strong>OFF</strong> (STARTTLS).
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-pass">
                {isResendSmtpHost(smtpHost)
                  ? "API key (password)"
                  : activePreset
                    ? "App Password"
                    : "Password"}
              </Label>
              <Input
                id="smtp-pass"
                type="password"
                autoComplete="new-password"
                placeholder={
                  activePreset ? "16-character App Password" : "Enter password"
                }
                className="bg-zinc-950/50 font-mono"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
              />
              {activePreset && (
                <p className="text-xs text-zinc-500">
                  Paste the 16-character App Password (spaces OK — they’re stripped server-side).
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">Secure (TLS / SSL)</p>
              <p className="text-xs text-zinc-500">
                {isLocalPostfix
                  ? "Keep OFF for local Postfix on port 25 (plain SMTP on 127.0.0.1)."
                  : "Port 465 uses implicit TLS; 587 uses STARTTLS. Leave on for Gmail/Yahoo/Outlook."}
              </p>
            </div>
            <Switch
              checked={secure}
              onCheckedChange={setSecure}
              disabled={isLocalPostfix}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onTest}
              disabled={testing || saving || sendingTest}
            >
              {testing && <Loader2 className="mr-2 size-4 animate-spin" />}
              {testing ? "Testing… (up to 12s)" : "Test SMTP"}
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={saving || testing}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save SMTP
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onSendTestEmail}
              disabled={sendingTest || testing || saving}
              className="border-zinc-700"
              title="Sends one real email from this SMTP to your own account email."
            >
              {sendingTest ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Send test email to myself
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Saved SMTP servers</CardTitle>
          <CardDescription>
            Passwords are encrypted with AES-256-GCM and stored in{" "}
            <span className="font-mono text-zinc-400">smtp_servers.password_enc</span>.
            {planSlotsLabel ? (
              <span className="mt-1 block text-zinc-500">{planSlotsLabel}</span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {savedError && (
            <p className="mb-3 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              {savedError}
            </p>
          )}
          {savedLoading && savedRows.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
              <Loader2 className="size-4 animate-spin" />
              Loading saved SMTP servers…
            </div>
          ) : savedRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-800 px-4 py-8 text-center">
              <p className="text-sm text-zinc-400">No SMTP servers saved yet.</p>
              <p className="mt-1 text-xs text-zinc-500">
                Click a preset above, fill in your credentials, then press <span className="text-zinc-300">Save SMTP</span>.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400">Label</TableHead>
                    <TableHead className="text-zinc-400">Provider</TableHead>
                    <TableHead className="text-zinc-400">Host</TableHead>
                    <TableHead className="text-zinc-400">Port</TableHead>
                    <TableHead className="text-zinc-400">Username</TableHead>
                    <TableHead className="text-zinc-400">TLS</TableHead>
                    <TableHead className="w-[220px] text-right text-zinc-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {savedRows.map((r) => {
                    const busy = rowBusyId === r.id;
                    return (
                      <TableRow key={r.id} className="border-zinc-800">
                        <TableCell className="font-medium text-zinc-200">
                          {r.label ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-zinc-700 text-xs">
                            {r.provider ?? "custom"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-zinc-300">{r.host}</TableCell>
                        <TableCell className="font-mono text-sm text-zinc-300">{r.port}</TableCell>
                        <TableCell className="font-mono text-sm text-zinc-300">
                          {r.username}
                        </TableCell>
                        <TableCell className="text-sm text-zinc-400">
                          {r.secure ? "yes" : "no"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-zinc-700"
                              onClick={() => onSendTestFromSaved(r.id)}
                              disabled={busy}
                              title="Send a test email using this saved SMTP"
                            >
                              {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Send className="size-4" />
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="border-zinc-700 hover:border-red-900 hover:bg-red-950/30 hover:text-red-300"
                              onClick={() => onDeleteSaved(r.id, r.label)}
                              disabled={busy}
                              aria-label={`Delete ${r.label ?? r.host}`}
                            >
                              {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Bulk SMTP upload</CardTitle>
          <CardDescription>
            One entry per line — <span className="font-mono text-zinc-400">email:pass</span> or{" "}
            <span className="font-mono text-zinc-400">email,pass</span> (CSV-friendly) or{" "}
            <span className="font-mono text-zinc-400">host,port,user,pass</span>. Gmail, Yahoo, and
            Outlook addresses auto-pick the right SMTP host from the domain (mixed CSVs are fine).
            For other domains, select a preset above or use a full{" "}
            <span className="font-mono text-zinc-400">host,port,user,pass</span> line. Header rows like{" "}
            <span className="font-mono text-zinc-400">email,app-password</span> are skipped. Choose files, review
            the preview, then <span className="text-zinc-300">Import valid SMTP servers</span> to save
            them to your account. Preview alone does not create servers — you must click Import.
            After a successful import, the next campaign sends rotate through{" "}
            <span className="text-zinc-300">only that batch</span> until you run another bulk import.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          <input
            ref={bulkUploadRef}
            id="bulk-smtp-upload"
            type="file"
            multiple
            accept=".txt,.csv,.log,text/plain,text/csv"
            className="hidden"
            tabIndex={-1}
            onChange={onBulkSmtpFileChange}
          />
          <div
            className={cn(
              "flex w-full min-w-0 items-center gap-3 rounded-lg border border-[#374151] bg-[#0F172A] px-4 py-3 shadow-none transition-[border-color,box-shadow]",
              "focus-within:border-emerald-500/45 focus-within:ring-2 focus-within:ring-emerald-500/15",
            )}
          >
            <button
              type="button"
              onClick={() => bulkUploadRef.current?.click()}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-[#1f2937] px-3.5 text-sm font-medium leading-none text-white transition-colors hover:bg-[#374151] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
            >
              Choose Files
            </button>
            <span
              className="min-w-0 flex-1 truncate pl-0.5 text-sm leading-normal text-white"
              title={
                smtpFiles.length === 0
                  ? undefined
                  : smtpFiles.map((s) => s.file.name).join(", ")
              }
            >
              {smtpFiles.length === 0
                ? "No file selected"
                : `${smtpFiles.length} file${smtpFiles.length === 1 ? "" : "s"} selected`}
            </span>
          </div>

          {smtpFiles.length > 0 && (
            <ul className="mt-1.5 space-y-1.5" aria-label="SMTP list files">
              {smtpFiles.map((item, index) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#2a2a2a] bg-[#0f172a] px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-white" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded-md p-1 text-[#9ca3af] transition-colors hover:text-[#ef4444] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removeSmtpFileAt(index)}
                  >
                    <X className="size-4" strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {bulkFileError && (
            <p className="mt-3 text-xs text-red-400" role="alert">
              {bulkFileError}
            </p>
          )}
          {!bulkFileError && smtpFiles.length === 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              Lines starting with <span className="font-mono">#</span> or{" "}
              <span className="font-mono">{"//"}</span> are ignored. Files are read in your browser;
              import sends only validated rows to the server (encrypted like single Save).
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={previewMode || bulkImporting || bulkValidCount === 0}
              className="bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
              onClick={() => void handleBulkImport()}
            >
              {bulkImporting ? (
                <>
                  <Loader2 className="me-1 size-4 animate-spin" />
                  Importing…
                </>
              ) : (
                "Import valid SMTP servers"
              )}
            </Button>
            {bulkDuplicateCount > 0 && (
              <span className="text-xs text-amber-200/90">
                {bulkDuplicateCount} duplicate(s) will be skipped.
              </span>
            )}
            {bulkInvalidCount > 0 && (
              <span className="text-xs text-red-300/90">
                {bulkInvalidCount} invalid row(s) will be skipped.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {bulkRows.length > 0 && (
        <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2 text-zinc-100">
                Preview
                <Badge
                  variant="secondary"
                  className="border-zinc-700 bg-zinc-800/80 text-zinc-200"
                >
                  Total SMTPs: {bulkValidCount}
                </Badge>
                {bulkDuplicateCount > 0 && (
                  <Badge
                    variant="outline"
                    className="border-amber-700/80 bg-amber-950/50 text-xs text-amber-200"
                  >
                    {bulkDuplicateCount} duplicate
                  </Badge>
                )}
                {bulkInvalidCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {bulkInvalidCount} invalid
                  </Badge>
                )}
                {bulkFormat && (
                  <Badge
                    variant="outline"
                    className="border-zinc-700 text-xs uppercase tracking-wide text-zinc-400"
                  >
                    {bulkFormat === "advanced"
                      ? "host,port,user,pass"
                      : "email:pass or email,pass"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Parsed from{" "}
                <span className="font-mono text-zinc-300" title={bulkSourceNames.join(", ")}>
                  {bulkSourceNames.length <= 2
                    ? bulkSourceNames.join(", ")
                    : `${bulkSourceNames.length} files`}
                </span>
                . Use <span className="text-zinc-300">Import valid SMTP servers</span> above to persist
                rows (server encrypts passwords).
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-700"
                disabled={bulkPage <= 1}
                onClick={() => setBulkPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular-nums text-zinc-400">
                Page {bulkPage} of {bulkTotalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-700"
                disabled={bulkPage >= bulkTotalPages}
                onClick={() => setBulkPage((p) => Math.min(bulkTotalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-16 text-zinc-400">#</TableHead>
                    {bulkFormat === "advanced" && (
                      <>
                        <TableHead className="text-zinc-400">Host</TableHead>
                        <TableHead className="text-zinc-400">Port</TableHead>
                      </>
                    )}
                    <TableHead className="text-zinc-400">
                      {bulkFormat === "advanced" ? "Username" : "Email / Username"}
                    </TableHead>
                    <TableHead className="text-zinc-400">Password</TableHead>
                    <TableHead className="w-[120px] text-right text-zinc-400">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bulkPageRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "border-zinc-800",
                        row.invalid && "bg-red-950/30",
                        row.duplicate && !row.invalid && "bg-amber-950/25",
                      )}
                    >
                      <TableCell className="text-xs tabular-nums text-zinc-500">
                        {row.lineNo}
                      </TableCell>
                      {bulkFormat === "advanced" && (
                        <>
                          <TableCell className="font-mono text-sm text-zinc-200">
                            {row.host ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-zinc-300">
                            {row.port ?? "—"}
                          </TableCell>
                        </>
                      )}
                      <TableCell
                        className={cn(
                          "font-mono text-sm",
                          row.invalid ? "text-red-300" : "text-zinc-200",
                        )}
                      >
                        {row.invalid ? row.raw : (row.username ?? "—")}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-zinc-400">
                        {row.invalid
                          ? "—"
                          : row.password
                            ? "•".repeat(Math.min(row.password.length, 10))
                            : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.invalid ? (
                          <Badge variant="destructive" className="text-xs" title={row.reason}>
                            Invalid
                          </Badge>
                        ) : row.duplicate ? (
                          <Badge
                            variant="outline"
                            className="border-amber-700/80 bg-amber-950/50 text-xs text-amber-200"
                            title={row.duplicateReason}
                          >
                            Duplicate
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="border-emerald-800/80 bg-emerald-950/60 text-emerald-200"
                          >
                            OK
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-center text-sm text-zinc-500">
              Showing {bulkStart}–{bulkEnd} of {bulkRows.length}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Rotation strategy</CardTitle>
          <CardDescription>Choose how outbound SMTP accounts rotate.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rotation">Strategy</Label>
            <Select
              value={rotation}
              onValueChange={(v) => {
                if (v != null) setRotation(v);
              }}
            >
              <SelectTrigger variant="devtool" id="rotation" className="w-full max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent variant="devtool">
                <SelectItem value="round-robin">Round Robin</SelectItem>
                <SelectItem value="random">Random</SelectItem>
                <SelectItem value="threshold">Threshold-based</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Separator className="bg-zinc-800" />
          <p className="text-xs text-zinc-500">
            Campaign sends split recipients across your saved SMTPs in{" "}
            <span className="text-zinc-400">even blocks</span> (e.g. 100 recipients and 5 SMTPs → 20
            sends per account in list order). Bulk import assigns{" "}
            <span className="font-mono text-zinc-400">rotation_order</span> from file order so that
            order matches your CSV/txt.
          </p>
        </CardContent>
      </Card>

      {onGoToComposer && (
        <Card className="border-zinc-800 border-emerald-500/25 bg-zinc-900/40 ring-1 ring-emerald-500/20">
          <CardHeader>
            <CardTitle className="text-zinc-100">Continue</CardTitle>
            <CardDescription>
              If the form above is complete, Next saves that SMTP, then opens Email Composer. If
              you already have a saved server, Next goes there without re-saving the form.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-800 pt-4">
            <Button
              type="button"
              size="lg"
              disabled={nexting}
              onClick={() => void handleNextToComposer()}
              className="min-w-[7rem] bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {nexting ? (
                <Loader2 className="me-1 size-4 shrink-0 animate-spin" />
              ) : null}
              Next
              <ChevronRight className="ms-1 size-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
