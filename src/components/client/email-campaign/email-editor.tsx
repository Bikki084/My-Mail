"use client";

import * as React from "react";
import { Loader2, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { listSmtpServers } from "@/app/actions/smtp";
import { queueCampaignSend } from "@/lib/campaign-send-client";
import { applyMergePreview, htmlToPlainText } from "@/lib/html-email";
import { useEmailCampaign } from "./email-campaign-context";

const ENCODINGS = [
  "none",
  "base64",
  "quoted-printable",
  "7bit",
  "8bit",
  "binary",
] as const;

type HeaderRow = { id: string; name: string; value: string };

function attachmentKey(f: File) {
  return `${f.name}-${f.size}-${f.lastModified}`;
}

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // 3 MB per file

export function EmailEditor({
  previewMode = false,
  isComposerActive = true,
}: {
  previewMode?: boolean;
  /** When true, refresh saved SMTP count (e.g. after returning from the SMTP tab). */
  isComposerActive?: boolean;
}) {
  const { campaignRecipients, lastParsedCsv, composeDraft, updateCompose } = useEmailCampaign();
  const [sending, setSending] = React.useState(false);
  const [savedSmtpCount, setSavedSmtpCount] = React.useState(0);
  const [convertHtml, setConvertHtml] = React.useState(false);
  const [headerOpen, setHeaderOpen] = React.useState(false);
  const [headerName, setHeaderName] = React.useState("");
  const [headerValue, setHeaderValue] = React.useState("");
  const [headers, setHeaders] = React.useState<HeaderRow[]>([
    { id: "1", name: "X-Campaign-Id", value: "preview-001" },
  ]);
  const attachRef = React.useRef<HTMLInputElement>(null);
  const [attachmentFiles, setAttachmentFiles] = React.useState<File[]>([]);

  /** Auto-derived plain text from the current HTML (read-only, re-computed on change). */
  const autoPlainText = React.useMemo(
    () => htmlToPlainText(composeDraft.html ?? ""),
    [composeDraft.html],
  );

  /** Live preview with mock merge data so recipients see substituted values at a glance. */
  const previewSubject = React.useMemo(
    () => applyMergePreview(composeDraft.subject ?? ""),
    [composeDraft.subject],
  );
  const previewHtmlSource = React.useMemo(
    () => applyMergePreview(composeDraft.html ?? ""),
    [composeDraft.html],
  );
  const previewText = React.useMemo(
    () => applyMergePreview(autoPlainText),
    [autoPlainText],
  );

  const refreshSmtpCount = React.useCallback(async () => {
    if (previewMode) return;
    const res = await listSmtpServers();
    if (res.ok) {
      setSavedSmtpCount((res.data ?? []).length);
    }
  }, [previewMode]);

  // Async fetch on mount / when composer activates. The setState inside
  // `refreshSmtpCount` runs after `await`, so it isn't synchronous within
  // the effect body — the lint rule can't see through the async boundary.
  React.useEffect(() => {
    if (previewMode) return;
    if (!isComposerActive) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSmtpCount();
  }, [isComposerActive, previewMode, refreshSmtpCount]);

  function addHeader() {
    if (!headerName.trim()) return;
    setHeaders((h) => [
      ...h,
      {
        id: crypto.randomUUID(),
        name: headerName.trim(),
        value: headerValue,
      },
    ]);
    setHeaderName("");
    setHeaderValue("");
    setHeaderOpen(false);
  }

  async function handleSend() {
    if (previewMode) {
      toast.message("Sign in with Supabase to send.");
      return;
    }
    if (campaignRecipients.length === 0) {
      toast.error("Add recipients", {
        description: 'Open the "Recipients (CSV Upload)" tab and upload a valid CSV with an email column.',
      });
      return;
    }
    if (savedSmtpCount < 1) {
      toast.error("No SMTP server", {
        description: "Open SMTP Configuration, save at least one server, then return here to send.",
      });
      return;
    }
    const stream = composeDraft.streamName.trim() || `Send ${new Date().toLocaleString()}`;
    const hasHtml = composeDraft.html.trim() !== "";
    if (!hasHtml && attachmentFiles.length === 0) {
      toast.error("Email content (HTML) is required", {
        description: "Write your message in Email Content (HTML), or add an attachment.",
      });
      return;
    }
    for (const f of attachmentFiles) {
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast.error("Attachment too large", {
          description: `${f.name} is over 3 MB. Use a smaller file or split it.`,
        });
        return;
      }
    }
    setSending(true);
    try {
      const res = await queueCampaignSend({
        streamName: stream,
        subject: composeDraft.subject,
        senderName: composeDraft.senderName,
        bodyHtml: composeDraft.html,
        encoding: composeDraft.encoding,
        recipients: campaignRecipients,
        attachmentFiles: attachmentFiles.length > 0 ? attachmentFiles : undefined,
      });
      if (!res.ok) {
        throw new Error(res.error);
      }
      if (res.mode === "delivered") {
        toast.success("Email sent", {
          description:
            "Messages were sent in this request. Check Sending & Logs, spam, and the recipient inboxes.",
        });
      } else {
        toast.success("Campaign queued for the worker", {
          duration: 10_000,
          description:
            "Leave `npm run worker` running in a terminal. It needs SUPABASE_SERVICE_ROLE_KEY, SMTP_ENCRYPTION_KEY, and REDIS_URL in .env.local. Open Sending & Logs to see per-recipient results. Check spam if nothing in inbox.",
        });
      }
      void refreshSmtpCount();
    } catch (e) {
      toast.error("Could not start send", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Message</CardTitle>
          <CardDescription>
            HTML is the primary content; plain text is generated automatically. Merge tags:{" "}
            <code className="text-xs text-zinc-300">{"{{name}}"}</code>,{" "}
            <code className="text-xs text-zinc-300">{"{{email}}"}</code>,{" "}
            <code className="text-xs text-zinc-300">c3</code>…
            <code className="text-xs text-zinc-300">c6</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sender-name">Sender name</Label>
            <Input
              id="sender-name"
              type="text"
              placeholder="Enter sender name"
              className="bg-zinc-950/50"
              value={composeDraft.senderName}
              onChange={(e) => updateCompose({ senderName: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              type="text"
              placeholder="Enter subject (supports {{name}})"
              className="bg-zinc-950/50"
              value={composeDraft.subject}
              onChange={(e) => updateCompose({ subject: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="body-html">Email Content (HTML)</Label>
            <Textarea
              id="body-html"
              className="min-h-40 bg-zinc-950/50 font-mono text-sm"
              placeholder="Write your HTML email here"
              value={composeDraft.html}
              onChange={(e) => updateCompose({ html: e.target.value })}
            />
            <p className="text-xs text-zinc-500">
              This is the main email content. A plain-text version will be automatically
              generated for compatibility.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="body-text-auto" className="text-zinc-400">
              Plain text (auto-generated)
            </Label>
            <Textarea
              id="body-text-auto"
              readOnly
              aria-readonly="true"
              tabIndex={-1}
              className="min-h-28 cursor-not-allowed select-text bg-zinc-950/70 font-mono text-sm text-zinc-300"
              placeholder="Will be generated from the HTML above"
              value={autoPlainText}
            />
            <p className="text-xs text-zinc-500">
              This is sent as a fallback for mail clients that don&apos;t render HTML. You
              can&apos;t edit it — it always mirrors the HTML above.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Live preview</CardTitle>
          <CardDescription>
            Merge tags are rendered with mock data (<code className="text-zinc-300">name = John Doe</code>,{" "}
            <code className="text-zinc-300">email = john@example.com</code>). Actual sends use each
            CSV row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-300">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">From</p>
            <p className="mt-1 text-zinc-200">{composeDraft.senderName || "—"}</p>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Subject</p>
            <p className="mt-1 font-medium text-zinc-100">{previewSubject || "—"}</p>
            <Separator className="my-4 bg-zinc-800" />
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Plain text (auto)
            </p>
            <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-zinc-300">
              {previewText || "—"}
            </p>
            <Separator className="my-4 bg-zinc-800" />
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">HTML (source)</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-400">
              {previewHtmlSource || "—"}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-zinc-200">Convert HTML to plain text</p>
              <p className="text-xs text-zinc-500">When both parts exist, derive text from HTML.</p>
            </div>
            <Switch checked={convertHtml} onCheckedChange={setConvertHtml} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="encoding">Encoding</Label>
            <Select
              value={composeDraft.encoding}
              onValueChange={(v) => {
                if (v != null) updateCompose({ encoding: v });
              }}
            >
              <SelectTrigger variant="devtool" id="encoding" className="w-full max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent variant="devtool">
                {ENCODINGS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e === "none" ? "None" : e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-zinc-100">Custom headers</CardTitle>
            <CardDescription>Optional headers to attach on send.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="border-zinc-700" onClick={() => setHeaderOpen(true)}>
            <Plus className="size-4" />
            Add header
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {headers.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 font-mono text-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-emerald-400/90">{row.name}</span>
              <span className="truncate text-zinc-400">{row.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Attachments</CardTitle>
          <CardDescription>
            Files selected here are sent with every message when you use SEND EMAIL (PDF, images,
            etc. — up to 3 MB per file, 5 files max). Add a short line in the message body (e.g. Hi)
            plus your PDF, or send attachment-only (a short text line is added automatically).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          <input
            ref={attachRef}
            type="file"
            multiple
            className="hidden"
            tabIndex={-1}
            onChange={(e) => {
              const picked = e.target.files ? Array.from(e.target.files) : [];
              if (picked.length) {
                setAttachmentFiles((prev) => {
                  const seen = new Set(prev.map(attachmentKey));
                  const next = [...prev];
                  for (const f of picked) {
                    const k = attachmentKey(f);
                    if (!seen.has(k)) {
                      seen.add(k);
                      next.push(f);
                    }
                  }
                  return next;
                });
              }
              e.target.value = "";
            }}
          />
          <div
            className={cn(
              "flex w-full min-w-0 items-center gap-3 rounded-lg border border-[#374151] bg-[#0F172A] px-4 py-3 shadow-none transition-[border-color,box-shadow]",
              "focus-within:border-emerald-500/45 focus-within:ring-2 focus-within:ring-emerald-500/15",
            )}
          >
            <button
              type="button"
              onClick={() => attachRef.current?.click()}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-[#1f2937] px-3.5 text-sm font-medium leading-none text-white transition-colors hover:bg-[#374151] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
            >
              Choose Files
            </button>
            <span
              className="min-w-0 flex-1 truncate pl-0.5 text-sm leading-normal text-white"
              title={
                attachmentFiles.length === 0
                  ? undefined
                  : attachmentFiles.map((f) => f.name).join(", ")
              }
            >
              {attachmentFiles.length === 0
                ? "No file chosen"
                : `${attachmentFiles.length} file${attachmentFiles.length === 1 ? "" : "s"} selected`}
            </span>
          </div>

          {attachmentFiles.length > 0 && (
            <ul className="mt-1.5 space-y-1.5" aria-label="Selected attachments">
              {attachmentFiles.map((file, index) => (
                <li
                  key={attachmentKey(file)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#2a2a2a] bg-[#0f172a] px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-white" title={file.name}>
                    {file.name}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded-md p-1 text-[#9ca3af] transition-colors hover:text-[#ef4444] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      setAttachmentFiles((prev) => {
                        const next = prev.filter((_, i) => i !== index);
                        if (next.length === 0 && attachRef.current) {
                          attachRef.current.value = "";
                        }
                        return next;
                      });
                    }}
                  >
                    <X className="size-4" strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 border-emerald-500/25 bg-zinc-900/40 ring-1 ring-emerald-500/20">
        <CardHeader>
          <CardTitle className="text-zinc-100">Send email</CardTitle>
          <CardDescription>
            With <code className="text-xs text-zinc-400">REDIS_URL</code> set, the app queues jobs — keep{" "}
            <code className="text-xs text-zinc-400">npm run worker</code> running; it must load the
            same             <code className="text-xs text-zinc-400">.env.local</code> (service role + SMTP
            encryption key). If send fails, read the error toast, check the Sending/Logs tab, the worker
            terminal, and spam. Not enough email credits? Add{" "}
            <code className="text-xs text-zinc-400">ALLOW_SEND_WITHOUT_EMAIL_CREDITS=1</code> in{" "}
            <code className="text-xs text-zinc-400">.env.local</code> for local testing.
            {lastParsedCsv ? ` File: ${lastParsedCsv.fileName}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {previewMode && (
            <p className="text-sm text-amber-200/90">
              Preview mode — connect Supabase and sign in to send.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="stream-name-send">Stream / campaign name</Label>
            <Input
              id="stream-name-send"
              type="text"
              placeholder="e.g. April outreach"
              className="bg-zinc-950/50"
              value={composeDraft.streamName}
              onChange={(e) => updateCompose({ streamName: e.target.value })}
              autoComplete="off"
            />
          </div>
          <p className="text-sm text-zinc-500">
            Recipients:{" "}
            <span className="font-medium text-zinc-200">{campaignRecipients.length}</span> — SMTP
            servers saved: <span className="font-medium text-zinc-200">{savedSmtpCount}</span>
          </p>
          <Button
            type="button"
            size="lg"
            className="inline-flex w-full min-w-[12rem] items-center justify-center gap-2 bg-emerald-600 text-white hover:bg-emerald-500 sm:w-auto"
            disabled={sending || previewMode}
            onClick={() => void handleSend()}
          >
            {sending ? (
              <>
                <Loader2 className="size-4 shrink-0 animate-spin" />
                Queuing…
              </>
            ) : (
              <>
                <Send className="size-4 shrink-0" />
                SEND EMAIL
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={headerOpen} onOpenChange={setHeaderOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add custom header</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="hdr-name">Name</Label>
              <Input
                id="hdr-name"
                value={headerName}
                onChange={(e) => setHeaderName(e.target.value)}
                placeholder="X-Custom-Header"
                className="bg-zinc-900"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hdr-value">Value</Label>
              <Input
                id="hdr-value"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                placeholder="value"
                className="bg-zinc-900"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setHeaderOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={addHeader}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
