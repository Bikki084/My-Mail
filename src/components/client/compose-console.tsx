"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { RefreshCw, ShoppingCart, Clock, Square, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { RecipientRow } from "@/lib/merge-tags";
import {
  MAIL_ENCODING_LABELS,
  MAIL_ENCODING_UI,
} from "@/lib/mail-encoding";
const PROVIDERS = ["Gmail", "Yahoo", "Outlook", "Custom"] as const;
const ROTATION = [
  { value: "round_robin", label: "Round Robin" },
  { value: "random", label: "Random" },
  { value: "threshold", label: "Threshold" },
] as const;
const ENCODINGS = MAIL_ENCODING_UI.map((value) => ({
  value,
  label: MAIL_ENCODING_LABELS[value],
}));

const MERGE_FIELDS: { key: keyof RecipientRow; label: string }[] = [
  { key: "email", label: "{{{email}}}" },
  { key: "name", label: "{{{name}}}" },
  { key: "c3", label: "{{{c3}}}" },
  { key: "c4", label: "{{{c4}}}" },
  { key: "c5", label: "{{{c5}}}" },
  { key: "c6", label: "{{{c6}}}" },
];

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function ComposeConsole() {
  // --- Module G: queue / monitor (UI state; wire to BullMQ later)
  const [serverGroup, setServerGroup] = useState("1. 01 Servers");
  const [serverIP] = useState("32.192.186.36");
  const [expireAt] = useState("12:32 am");
  const [smtpLoaded, setSmtpLoaded] = useState(0);
  const [smtpFailed] = useState(1);
  const [sentOk, setSentOk] = useState(0);
  const [sentFailed] = useState(0);
  const [rotationStrategy, setRotationStrategy] = useState<string>("round_robin");
  const [delayMs, setDelayMs] = useState(0);
  const [hostname, setHostname] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [sending, setSending] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  // --- Module D: CSV & recipients
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [dupDropped, setDupDropped] = useState(0);
  const [invalidEmails, setInvalidEmails] = useState(0);
  const [previewPage, setPreviewPage] = useState(0);
  const previewSize = 8;
  const csvRef = useRef<HTMLInputElement>(null);

  // --- Module E: SMTP row
  const [provider, setProvider] = useState<string>("Gmail");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [secure, setSecure] = useState(true);
  const credFileRef = useRef<HTMLInputElement>(null);

  // --- Module F: composer
  const [senderName, setSenderName] = useState("test");
  const [subjectLine, setSubjectLine] = useState("test");
  const [textBody, setTextBody] = useState("");
  const [htmlBody, setHtmlBody] = useState("");
  const [autoFromHtml, setAutoFromHtml] = useState(true);
  const [encoding, setEncoding] = useState("auto");
  const [headersOpen, setHeadersOpen] = useState(false);
  const [headerDraft, setHeaderDraft] = useState<{ name: string; value: string }[]>([
    { name: "X-Priority", value: "1" },
  ]);
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<string[]>([]);

  const previewRows = useMemo(() => {
    const start = previewPage * previewSize;
    return recipients.slice(start, start + previewSize);
  }, [recipients, previewPage, previewSize]);
  const previewPages = Math.max(1, Math.ceil(recipients.length / previewSize));

  const parseCsvFile = useCallback((file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const seen = new Set<string>();
        const rows: RecipientRow[] = [];
        let dup = 0;
        let bad = 0;
        for (const row of res.data) {
          const raw = (row.email ?? row.Email ?? "").trim();
          const email = raw.toLowerCase();
          if (!email) continue;
          if (!isValidEmail(email)) {
            bad++;
            continue;
          }
          if (seen.has(email)) {
            dup++;
            continue;
          }
          seen.add(email);
          rows.push({
            email,
            name: row.name ?? row.Name ?? "",
            c3: row.c3 ?? row.C3 ?? "",
            c4: row.c4 ?? row.C4 ?? "",
            c5: row.c5 ?? row.C5 ?? "",
            c6: row.c6 ?? row.C6 ?? "",
          });
        }
        setRecipients(rows);
        setDupDropped(dup);
        setInvalidEmails(bad);
        setPreviewPage(0);
        toast.success(`Loaded ${rows.length} recipients (${dup} dup, ${bad} invalid)`);
      },
      error: (err) => toast.error(err.message),
    });
  }, []);

  function handleStop() {
    setSending(false);
    toast.message("Stop requested", { description: "Queue will drain after current batch (Module G)." });
  }

  function handleStartSend() {
    if (!recipients.length) {
      toast.error("Upload a CSV with at least one valid email (Module D).");
      return;
    }
    setSending(true);
    setProgressPct(0);
    // Demo animation
    let p = 0;
    const id = window.setInterval(() => {
      p += 5;
      if (p >= 100) {
        window.clearInterval(id);
        setSending(false);
        setProgressPct(100);
        setSentOk((s) => s + Math.min(recipients.length, 10));
        toast.success("Demo: campaign finished — connect API for real sends.");
      } else {
        setProgressPct(p);
      }
    }, 200);
  }

  return (
    <div className="flex min-h-svh flex-col gap-0 lg:flex-row">
      {/* Left: servers + rotation + progress + stop (E + G) */}
      <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-zinc-800 p-4 lg:w-[300px] lg:border-b-0 lg:border-r">
        <div className="space-y-2">
          <Label className="text-zinc-400">Servers</Label>
          <Select
            value={serverGroup}
            onValueChange={(v) => {
              if (v) setServerGroup(v);
            }}
          >
            <SelectTrigger className="border-zinc-700 bg-zinc-900 text-white">
              <ShoppingCart className="mr-2 size-4 text-zinc-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900">
              <SelectItem value="1. 01 Servers">1. 01 Servers</SelectItem>
              <SelectItem value="2. Extra pool">2. Extra pool</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-300">
          <div className="flex items-center justify-between gap-2">
            <span className="text-zinc-500">Server IP</span>
            <button
              type="button"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              aria-label="Refresh"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
          <p className="mt-1 font-mono text-sm text-white">{serverIP}</p>
          <p className="mt-2 text-zinc-500">
            Expire At: <span className="text-zinc-300">{expireAt}</span>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Smtps</p>
            <p className="text-lg font-semibold text-blue-400">{smtpLoaded}</p>
            <p className="text-xs text-red-400">Failed: {smtpFailed}</p>
            <button
              type="button"
              className="mt-1 text-[10px] text-blue-400 underline"
              onClick={() => setLogsOpen(true)}
            >
              Get logs
            </button>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Sent</p>
            <p className="text-lg font-semibold text-emerald-400">{sentOk}</p>
            <p className="text-xs text-red-400">Failed: {sentFailed}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-zinc-400">SMTP rotation</Label>
          <Select
            value={rotationStrategy}
            onValueChange={(v) => {
              if (v) setRotationStrategy(v);
            }}
          >
            <SelectTrigger className="border-zinc-700 bg-zinc-900 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900">
              {ROTATION.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-zinc-400">
            <Clock className="size-3.5" />
            Delay (ms)
          </Label>
          <Input
            type="number"
            min={0}
            value={delayMs}
            onChange={(e) => setDelayMs(Number(e.target.value) || 0)}
            className="border-zinc-700 bg-zinc-900 text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-zinc-400">Hostname</Label>
          <Input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="eg. John.macbook.local"
            className="border-zinc-700 bg-zinc-900 text-white placeholder:text-zinc-600"
          />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-zinc-500">
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="w-full gap-2 bg-red-600 hover:bg-red-700"
          onClick={handleStop}
          disabled={!sending}
        >
          <Square className="size-4 fill-current" />
          STOP
        </Button>
      </aside>

      {/* Center: D + E + F */}
      <div className="min-w-0 flex-1 space-y-4 p-4 lg:overflow-y-auto">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="border-zinc-700 bg-zinc-800 px-3 py-1 text-white">
            {recipients.length} recipients
          </Badge>
          {dupDropped > 0 && (
            <span className="text-xs text-amber-400">{dupDropped} duplicates skipped</span>
          )}
          {invalidEmails > 0 && (
            <span className="text-xs text-red-400">{invalidEmails} malformed emails</span>
          )}
          <input
            ref={csvRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parseCsvFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-zinc-600 bg-zinc-900 text-zinc-200"
            onClick={() => csvRef.current?.click()}
          >
            Upload CSV
          </Button>
        </div>

        {/* Module E: provider row */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="min-w-[120px] space-y-1">
            <Label className="text-xs text-zinc-500">Provider</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                if (v) setProvider(v);
              }}
            >
              <SelectTrigger className="border-zinc-700 bg-zinc-950 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-900">
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px] flex-1 space-y-1">
            <Label className="text-xs text-zinc-500">Host</Label>
            <Input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.gmail.com"
              className="border-zinc-700 bg-zinc-950 text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-500">1 user | pass</Label>
            <input
              ref={credFileRef}
              type="file"
              accept=".txt,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setSmtpLoaded((n) => n + 1);
                  toast.message("Credential file staged", { description: f.name });
                }
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-zinc-600 whitespace-nowrap"
              onClick={() => credFileRef.current?.click()}
            >
              Choose file
            </Button>
          </div>
          <div className="w-24 space-y-1">
            <Label className="text-xs text-zinc-500">Port</Label>
            <Input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              className="border-zinc-700 bg-zinc-950 text-white"
            />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Label htmlFor="secure" className="text-xs text-zinc-400">
              Secure
            </Label>
            <Switch
              id="secure"
              checked={secure}
              onCheckedChange={(v) => setSecure(Boolean(v))}
            />
          </div>
        </div>

        {/* Module F */}
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-zinc-400">Sender name</Label>
              <Input
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="border-zinc-700 bg-zinc-950 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-400">Subject line</Label>
              <Input
                value={subjectLine}
                onChange={(e) => setSubjectLine(e.target.value)}
                className="border-zinc-700 bg-zinc-950 text-white"
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <Label className="text-zinc-400">Text body</Label>
              <div className="flex items-center gap-2">
                <Label htmlFor="autohtml" className="text-xs font-normal text-zinc-500">
                  Auto convert from HTML
                </Label>
                <Switch
                  id="autohtml"
                  checked={autoFromHtml}
                  onCheckedChange={(v) => {
                    setAutoFromHtml(Boolean(v));
                    if (v && htmlBody) {
                      const tmp = document.createElement("div");
                      tmp.innerHTML = htmlBody;
                      setTextBody(tmp.textContent || "");
                    }
                  }}
                />
              </div>
            </div>
            <Textarea
              value={textBody}
              onChange={(e) => setTextBody(e.target.value)}
              rows={5}
              className="border-zinc-700 bg-zinc-950 font-mono text-sm text-white"
              placeholder="Plain text version…"
            />
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] space-y-1">
                <Label className="text-zinc-400">Encoding</Label>
                <Select
                  value={encoding}
                  onValueChange={(v) => {
                    if (v) setEncoding(v);
                  }}
                >
                  <SelectTrigger className="border-zinc-700 bg-zinc-950 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    {ENCODINGS.map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Label className="text-zinc-400">Body HTML</Label>
            <Textarea
              value={htmlBody}
              onChange={(e) => {
                setHtmlBody(e.target.value);
                if (autoFromHtml) {
                  const tmp = document.createElement("div");
                  tmp.innerHTML = e.target.value;
                  setTextBody(tmp.textContent || "");
                }
              }}
              rows={10}
              className="border-zinc-700 bg-zinc-950 font-mono text-sm text-white"
              placeholder="<p>Hello {{{name}}},</p>"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-zinc-400">Attachments</Label>
            <input
              ref={attachRef}
              type="file"
              multiple
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) {
                  setAttachments(Array.from(files).map((f) => f.name));
                  toast.message(`${files.length} file(s) attached (Module F)`);
                }
                e.target.value = "";
              }}
            />
            <div className="flex w-full min-w-0 items-center gap-3 rounded-[10px] border border-[#2a2a2a] bg-[#0f172a] px-4 pt-3 pb-5 transition-[border-color] focus-within:border-emerald-500/40 focus-within:ring-2 focus-within:ring-emerald-500/15">
              <button
                type="button"
                onClick={() => attachRef.current?.click()}
                className="shrink-0 cursor-pointer rounded-lg border-0 bg-[#1f2937] px-[14px] py-2 text-sm font-medium leading-normal text-white shadow-none transition-colors hover:bg-[#374151] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
              >
                Select Files
              </button>
              <span
                className="min-w-0 flex-1 truncate text-[14px] leading-normal text-[#9ca3af]"
                title={
                  attachments.length === 0
                    ? undefined
                    : attachments.length === 1
                      ? attachments[0]
                      : attachments.join(", ")
                }
              >
                {attachments.length === 0
                  ? "No file selected"
                  : attachments.length === 1
                    ? attachments[0]
                    : `${attachments.length} files selected`}
              </span>
            </div>
          </div>
        </div>

        {/* Module D: paginated preview */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/20">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="text-sm font-medium text-zinc-300">Recipient preview</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-zinc-400"
                disabled={previewPage <= 0}
                onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-zinc-400"
                disabled={previewPage >= previewPages - 1}
                onClick={() => setPreviewPage((p) => Math.min(previewPages - 1, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[220px]">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">email</TableHead>
                  <TableHead className="text-zinc-400">name</TableHead>
                  <TableHead className="text-zinc-400">c3</TableHead>
                  <TableHead className="text-zinc-400">c4</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((r) => (
                  <TableRow key={r.email} className="border-zinc-800">
                    <TableCell className="font-mono text-xs text-zinc-300">{r.email}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{r.name}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{r.c3}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{r.c4}</TableCell>
                  </TableRow>
                ))}
                {!previewRows.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-zinc-500">
                      Upload a CSV to preview (Module D)
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
          <p className="border-t border-zinc-800 px-3 py-2 text-center text-[11px] text-zinc-600">
            Page {previewPage + 1} / {previewPages} · {recipients.length} total
          </p>
        </div>

        <div className="flex flex-wrap gap-3 pb-8">
          <Button
            type="button"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleStartSend}
            disabled={sending}
          >
            {sending ? "Sending…" : "Start send (demo)"}
          </Button>
          <p className="text-xs text-zinc-500 self-center">
            Module G: connect BullMQ + API for production queue & logs.
          </p>
        </div>
      </div>

      {/* Right: merge tags + headers (D + F) */}
      <aside className="w-full shrink-0 border-t border-zinc-800 p-4 lg:w-[280px] lg:border-l lg:border-t-0">
        <h3 className="mb-3 text-sm font-semibold text-white">Tags & headers</h3>
        <p className="mb-3 text-xs text-zinc-500">
          Merge tags for subject/body (Module D). Custom headers in modal (Module F).
        </p>
        <div className="space-y-3">
          {MERGE_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-[10px] uppercase text-zinc-500">{f.label}</Label>
              <Input readOnly value={f.label} className="border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-300" />
            </div>
          ))}
        </div>
        <Separator className="my-4 bg-zinc-800" />
        <Button
          type="button"
          className="w-full gap-1 bg-blue-600 hover:bg-blue-700"
          onClick={() => setHeadersOpen(true)}
        >
          <Plus className="size-4" />
          Configure email headers
        </Button>

        <Dialog open={headersOpen} onOpenChange={setHeadersOpen}>
          <DialogContent className="border-zinc-700 bg-zinc-950 text-white sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Custom email headers</DialogTitle>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto">
              {headerDraft.map((h, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Header name"
                    value={h.name}
                    onChange={(e) => {
                      const next = [...headerDraft];
                      next[i] = { ...next[i], name: e.target.value };
                      setHeaderDraft(next);
                    }}
                    className="border-zinc-700 bg-zinc-900"
                  />
                  <Input
                    placeholder="Value"
                    value={h.value}
                    onChange={(e) => {
                      const next = [...headerDraft];
                      next[i] = { ...next[i], value: e.target.value };
                      setHeaderDraft(next);
                    }}
                    className="border-zinc-700 bg-zinc-900"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full border-zinc-600"
                onClick={() => setHeaderDraft([...headerDraft, { name: "", value: "" }])}
              >
                Add row
              </Button>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setHeadersOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet open={logsOpen} onOpenChange={setLogsOpen}>
          <SheetContent side="right" className="border-zinc-800 bg-zinc-950 text-white sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Sending logs</SheetTitle>
              <SheetDescription className="text-zinc-500">
                Per-recipient status — wire to `sending_logs` + BullMQ (Module G).
              </SheetDescription>
            </SheetHeader>
            <Table className="mt-6">
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead className="text-zinc-400">Recipient</TableHead>
                  <TableHead className="text-zinc-400">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-zinc-800">
                  <TableCell className="font-mono text-xs">demo@mail.com</TableCell>
                  <TableCell className="text-emerald-400">sent</TableCell>
                </TableRow>
                <TableRow className="border-zinc-800">
                  <TableCell className="font-mono text-xs">bad@…</TableCell>
                  <TableCell className="text-red-400">failed</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </SheetContent>
        </Sheet>
      </aside>
    </div>
  );
}
