"use client";

import * as React from "react";
import { Eye, FileText, ImageIcon, Loader2, Paperclip, Plus, Send } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { listSmtpServers } from "@/app/actions/smtp";
import { getLastBulkImportedSmtpIds } from "@/lib/bulk-smtp-session";
import {
  previewCampaignEmail,
  queueCampaignSend,
} from "@/lib/campaign-send-client";
import { applyMergePreview, buildPreviewRecipient, htmlToPlainText } from "@/lib/html-email";
import { randomId } from "@/lib/random-id";
import { useEmailCampaign } from "./email-campaign-context";
import { MergeTagAutocompleteField } from "./merge-tag-autocomplete-field";
import { MergeTagInsertMenu } from "./merge-tag-insert";
import { mergeTagKeysForAutocomplete } from "@/lib/merge-tags";
import { useWalletState } from "./wallet-state-context";

type HeaderRow = { id: string; name: string; value: string };

export function EmailEditor({
  previewMode = false,
  isComposerActive = true,
}: {
  previewMode?: boolean;
  /** When true, refresh saved SMTP count (e.g. after returning from the SMTP tab). */
  isComposerActive?: boolean;
}) {
  const {
    campaignRecipients,
    lastParsedCsv,
    builtInMergeTags,
    composeDraft,
    updateCompose,
    composerUi,
    updateComposerUi,
  } = useEmailCampaign();
  const { timer } = useWalletState();
  const [sending, setSending] = React.useState(false);
  const [savedSmtpCount, setSavedSmtpCount] = React.useState(0);
  const [headerOpen, setHeaderOpen] = React.useState(false);
  const [headerName, setHeaderName] = React.useState("");
  const [headerValue, setHeaderValue] = React.useState("");
  const [headers, setHeaders] = React.useState<HeaderRow[]>([
    { id: "1", name: "X-Campaign-Id", value: "preview-001" },
  ]);
  const { attachmentKind, attachmentHtml } = composerUi;
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewHtmlMerged, setPreviewHtmlMerged] = React.useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = React.useState<{
    subject: string;
    senderName: string;
    previewTo: string;
    attachmentNames: string[];
    warnings: string[];
  } | null>(null);

  /** Auto-derived plain text from the current HTML (read-only, re-computed on change). */
  const autoPlainText = React.useMemo(
    () => htmlToPlainText(composeDraft.html ?? ""),
    [composeDraft.html],
  );

  /**
   * Build the preview recipient from the uploaded CSV when available so
   * arbitrary merge tags (e.g. `{{{city}}}`) substitute against the user's
   * own data rather than only the static mock.
   */
  const previewRow = React.useMemo(
    () => buildPreviewRecipient(lastParsedCsv, builtInMergeTags),
    [lastParsedCsv, builtInMergeTags],
  );

  const builtInTagKeys = React.useMemo(
    () => builtInMergeTags.map((t) => t.key.trim()).filter(Boolean),
    [builtInMergeTags],
  );

  const autocompleteTagKeys = React.useMemo(
    () =>
      mergeTagKeysForAutocomplete(lastParsedCsv?.columnOrder ?? [], builtInTagKeys),
    [lastParsedCsv, builtInTagKeys],
  );

  /** Live preview with mock merge data so recipients see substituted values at a glance. */
  const previewSubject = React.useMemo(
    () =>
      applyMergePreview(composeDraft.subject ?? "", previewRow, {
        missingFormat: "plain",
      }),
    [composeDraft.subject, previewRow],
  );
  const previewHtmlSource = React.useMemo(
    () => applyMergePreview(composeDraft.html ?? "", previewRow),
    [composeDraft.html, previewRow],
  );
  const previewText = React.useMemo(
    () => applyMergePreview(autoPlainText, previewRow),
    [autoPlainText, previewRow],
  );

  const senderDisplay = React.useMemo(
    () => composeDraft.senderName?.trim() || "(no sender name yet)",
    [composeDraft.senderName],
  );
  const previewToDisplay = React.useMemo(
    () => campaignRecipients[0]?.email ?? "john@example.com",
    [campaignRecipients],
  );
  const attachmentMeta = React.useMemo<{
    filename: string;
    icon: "pdf" | "img";
    label: string;
  } | null>(() => {
    if (!attachmentKind) return null;
    if (attachmentKind === "pdf") {
      return { filename: "attachment.pdf", icon: "pdf", label: "PDF" };
    }
    if (attachmentKind === "jpeg") {
      return { filename: "attachment.jpg", icon: "img", label: "JPEG image" };
    }
    if (attachmentKind === "pdf_image") {
      return { filename: "attachment.png", icon: "img", label: "PDF image (PNG)" };
    }
    return { filename: "attachment.png", icon: "img", label: "PNG image" };
  }, [attachmentKind]);
  const attachmentPreviewHtml = React.useMemo(
    () => applyMergePreview(attachmentHtml, previewRow),
    [attachmentHtml, previewRow],
  );

  /**
   * Build the document we hand to a sandboxed iframe via `srcDoc`. We mirror
   * the server-side `wrapForRender` heuristic: if the user already wrote a
   * full HTML document, leave it alone; otherwise wrap with a neutral
   * email-style shell so the preview matches what an email client would show.
   * `<base target="_blank">` makes any link clicks open in a new tab instead
   * of trying to navigate the iframe.
   */
  const buildPreviewDoc = React.useCallback(
    (rawHtml: string, emptyLabel: string): string => {
      const t = (rawHtml ?? "").trim();
      const isFullDoc = /^\s*<!doctype/i.test(t) || /<html[\s>]/i.test(t);
      if (isFullDoc) return t;
      const inner = t
        ? t
        : `<p style="margin:0;color:#9ca3af;font-style:italic">${emptyLabel}</p>`;
      return [
        "<!DOCTYPE html><html><head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<base target="_blank">',
        "<style>",
        "html,body{margin:0;padding:16px;background:#fff;color:#111;",
        "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;",
        "line-height:1.5;font-size:14px;word-break:break-word;}",
        "img{max-width:100%;height:auto}",
        "a{color:#2563eb}",
        "table{border-collapse:collapse}",
        "</style></head><body>",
        inner,
        "</body></html>",
      ].join("");
    },
    [],
  );

  const bodyPreviewDoc = React.useMemo(
    () => buildPreviewDoc(previewHtmlSource, "(empty body — write HTML in the Email Content card above)"),
    [previewHtmlSource, buildPreviewDoc],
  );
  const attachmentPreviewDoc = React.useMemo(
    () =>
      attachmentKind && attachmentPreviewHtml.trim()
        ? buildPreviewDoc(attachmentPreviewHtml, "(empty attachment HTML)")
        : null,
    [attachmentKind, attachmentPreviewHtml, buildPreviewDoc],
  );

  const htmlAttachmentPayload = React.useMemo(() => {
    if (!attachmentKind || !attachmentHtml.trim()) return null;
    return { kind: attachmentKind, html: attachmentHtml.trim() };
  }, [attachmentKind, attachmentHtml]);

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
        id: randomId(),
        name: headerName.trim(),
        value: headerValue,
      },
    ]);
    setHeaderName("");
    setHeaderValue("");
    setHeaderOpen(false);
  }

  async function handlePreviewEmail() {
    if (previewMode) {
      toast.message("Sign in with Supabase to preview.");
      return;
    }
    if (attachmentKind && !attachmentHtml.trim()) {
      toast.error("Attachment HTML required", {
        description: "Enter HTML for the PDF or image attachment, or clear the attachment type.",
      });
      return;
    }
    const hasHtml = composeDraft.html.trim() !== "";
    const hasGenAttach = Boolean(htmlAttachmentPayload);
    if (!hasHtml && !hasGenAttach) {
      toast.error("Email content (HTML) is required", {
        description:
          "Write your message in Email Content (HTML), or add a generated PDF/image attachment from HTML.",
      });
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await previewCampaignEmail({
        subject: composeDraft.subject,
        senderName: composeDraft.senderName,
        bodyHtml: composeDraft.html,
        encoding: "auto",
        previewTo: campaignRecipients[0]?.email ?? "",
        attachmentNames: [],
        htmlAttachment: htmlAttachmentPayload,
      });
      if (!res.ok) {
        throw new Error(res.error);
      }
      const d = res.data;
      if (d.warnings.length) {
        for (const w of d.warnings) {
          toast.warning(w);
        }
      }
      setPreviewMeta({
        subject: d.subject,
        senderName: d.senderName,
        previewTo: d.previewTo,
        attachmentNames: d.attachmentNames,
        warnings: d.warnings,
      });
      setPreviewHtmlMerged(applyMergePreview(d.finalHtml, previewRow));
      setPreviewOpen(true);
    } catch (e) {
      toast.error("Could not build preview", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPreviewLoading(false);
    }
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
    if (!previewMode && !timer.planRunning) {
      toast.error("No active server plan", {
        description:
          "Open Wallet & Plan, activate a plan with your wallet credits, then you can send campaigns.",
      });
      return;
    }
    const stream = composeDraft.streamName.trim() || `Send ${new Date().toLocaleString()}`;
    if (attachmentKind && !attachmentHtml.trim()) {
      toast.error("Attachment HTML required", {
        description: "Enter HTML for the PDF or image attachment, or clear the attachment type.",
      });
      return;
    }
    const hasHtml = composeDraft.html.trim() !== "";
    const hasGenAttach = Boolean(htmlAttachmentPayload);
    if (!hasHtml && !hasGenAttach) {
      toast.error("Email content (HTML) is required", {
        description:
          "Write your message in Email Content (HTML), or add a generated PDF/image attachment from HTML.",
      });
      return;
    }
    setSending(true);
    try {
      const smtpRes = await listSmtpServers();
      if (!smtpRes.ok) {
        throw new Error(smtpRes.error);
      }
      const smtpRows = smtpRes.data ?? [];
      const savedIdSet = new Set(smtpRows.map((r) => r.id));
      const bulkScope = getLastBulkImportedSmtpIds();
      const scopedBulkIds =
        bulkScope?.filter((id) => savedIdSet.has(id)) ?? [];
      const smtpServerIds =
        scopedBulkIds.length > 0 ? scopedBulkIds : smtpRows.map((r) => r.id);
      if (smtpServerIds.length === 0) {
        toast.error("No SMTP server", {
          description: "Open SMTP Configuration, save at least one server, then return here to send.",
        });
        return;
      }

      const rowsForSend = smtpRows.filter((r) => smtpServerIds.includes(r.id));
      const distinctLogins = new Set(
        rowsForSend.map((r) => `${r.username.trim().toLowerCase()}|${r.host.trim().toLowerCase()}`),
      );
      if (rowsForSend.length > 1 && distinctLogins.size === 1) {
        toast.warning("SMTP accounts look identical", {
          description:
            "Every server in this send uses the same email + host. Rotation will not change the sender mailbox — use different accounts in your CSV.",
          duration: 12_000,
        });
      }

      if (scopedBulkIds.length > 0) {
        toast.message("SMTP scope: last bulk import", {
          description: `This send uses ${scopedBulkIds.length} account(s) from your latest bulk import (not every saved server). Import another CSV to change the set.`,
          duration: 8_000,
        });
      }

      const res = await queueCampaignSend({
        streamName: stream,
        subject: composeDraft.subject,
        senderName: composeDraft.senderName,
        bodyHtml: composeDraft.html,
        encoding: "auto",
        recipients: campaignRecipients,
        htmlAttachment: htmlAttachmentPayload,
        smtpServerIds,
        rotationStrategy: "round_robin",
      });
      if (!res.ok) {
        throw new Error(res.error);
      }
      if (res.warnings?.length) {
        for (const w of res.warnings) {
          toast.warning(w);
        }
      }
      if (res.mode === "delivered") {
        toast.success("Email sent", {
          description:
            "Messages were sent in this request. Check Sending & Logs, spam, and the recipient inboxes.",
        });
      } else if (res.mode === "started") {
        toast.success("Send started", {
          duration: 8_000,
          description:
            "Delivery is running in the background. Open Sending & Logs to watch per-recipient results — they appear as each message goes out. Check spam if a recipient doesn't see it.",
        });
      } else {
        toast.success("Campaign queued for the worker", {
          duration: 10_000,
          description:
            "The worker will pick the job up from Redis. Open Sending & Logs to see per-recipient results. Check spam if nothing in inbox.",
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
            HTML is the primary content; plain text is generated automatically. Type{" "}
            <code className="text-xs text-zinc-300">{"{"}</code> in subject or body to pick a
            merge tag from your CSV.
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="subject">Subject</Label>
              <MergeTagInsertMenu
                lastParsedCsv={lastParsedCsv}
                builtInMergeTags={builtInMergeTags}
                onInsert={(tag) =>
                  updateCompose({ subject: `${composeDraft.subject}${tag}` })
                }
              />
            </div>
            <MergeTagAutocompleteField
              id="subject"
              placeholder="Welcome, {{{name}}}"
              className="bg-zinc-950/50"
              tagKeys={autocompleteTagKeys}
              value={composeDraft.subject}
              onChange={(subject) => updateCompose({ subject })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="body-html">Email Content (HTML)</Label>
            <MergeTagAutocompleteField
              id="body-html"
              multiline
              placeholder="Write your HTML email here"
              className="min-h-40"
              tagKeys={autocompleteTagKeys}
              value={composeDraft.html}
              onChange={(html) => updateCompose({ html })}
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
            {lastParsedCsv && lastParsedCsv.rows.length > 0 ? (
              <>
                Merge tags are rendered against the first valid row in{" "}
                <code className="text-zinc-300">{lastParsedCsv.fileName}</code>. Any CSV column
                works as <code className="text-zinc-300">{"{{{column}}}"}</code>.
              </>
            ) : (
              <>
                Merge tags are rendered with mock data (
                <code className="text-zinc-300">name = John Doe</code>,{" "}
                <code className="text-zinc-300">email = john@example.com</code>). Upload a CSV to
                preview against your own columns (<code className="text-zinc-300">{"{{{city}}}"}</code>
                , <code className="text-zinc-300">{"{{{state}}}"}</code>, …).
              </>
            )}
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
          <CardTitle className="text-zinc-100">Attachment (from HTML)</CardTitle>
          <CardDescription>
            Choose PDF, PDF image (PNG snapshot), PNG, or JPEG. Use only merge tags from your CSV
            (see Recipients tab). Unknown tags show as <strong>Missing tag</strong> in preview and
            at send time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="sr-only">Attachment format</legend>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                <input
                  type="radio"
                  name="attachment-kind"
                  className="size-4 accent-emerald-600"
                  checked={attachmentKind === "pdf"}
                  onChange={() => updateComposerUi({ attachmentKind: "pdf" })}
                />
                PDF
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                <input
                  type="radio"
                  name="attachment-kind"
                  className="size-4 accent-emerald-600"
                  checked={attachmentKind === "pdf_image"}
                  onChange={() => updateComposerUi({ attachmentKind: "pdf_image" })}
                />
                PDF image
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                <input
                  type="radio"
                  name="attachment-kind"
                  className="size-4 accent-emerald-600"
                  checked={attachmentKind === "png"}
                  onChange={() => updateComposerUi({ attachmentKind: "png" })}
                />
                PNG image
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
                <input
                  type="radio"
                  name="attachment-kind"
                  className="size-4 accent-emerald-600"
                  checked={attachmentKind === "jpeg"}
                  onChange={() => updateComposerUi({ attachmentKind: "jpeg" })}
                />
                JPEG image
              </label>
              {attachmentKind != null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-zinc-400 hover:text-zinc-100"
                  onClick={() => {
                    updateComposerUi({ attachmentKind: null, attachmentHtml: "" });
                  }}
                >
                  Clear attachment
                </Button>
              ) : null}
            </div>
          </fieldset>

          {attachmentKind != null ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="attachment-html">Enter the HTML for the attachment</Label>
                <MergeTagInsertMenu
                  lastParsedCsv={lastParsedCsv}
                  builtInMergeTags={builtInMergeTags}
                  onInsert={(tag) =>
                    updateComposerUi({ attachmentHtml: `${attachmentHtml}${tag}` })
                  }
                />
              </div>
              <MergeTagAutocompleteField
                id="attachment-html"
                multiline
                className="field-sizing-fixed h-64 max-h-64 min-h-0 resize-none overflow-auto"
                placeholder={
                  attachmentKind === "pdf" || attachmentKind === "pdf_image"
                    ? "<div><h1>Invoice</h1><p>City: {{{city}}}</p></div>"
                    : '<div style="width:400px"><h2>Banner</h2></div>'
                }
                tagKeys={autocompleteTagKeys}
                value={attachmentHtml}
                onChange={(attachmentHtml) => updateComposerUi({ attachmentHtml })}
              />
              {attachmentKind === "jpeg" ? (
                <p className="text-xs text-zinc-500">
                  JPEG has no transparency — set a CSS background colour on
                  your container if needed (default white).
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-zinc-800 border-emerald-500/25 bg-zinc-900/40 ring-1 ring-emerald-500/20">
        <CardHeader>
          <CardTitle className="text-zinc-100">Send email</CardTitle>
          <CardDescription>
            With <code className="text-xs text-zinc-400">REDIS_URL</code> set, the app queues jobs —{" "}
            <code className="text-xs text-zinc-400">npm run dev</code> starts the email worker automatically, or run{" "}
            <code className="text-xs text-zinc-400">npm run worker</code> yourself if you use{" "}
            <code className="text-xs text-zinc-400">npm run dev:next</code>. The worker must load the same{" "}
            <code className="text-xs text-zinc-400">.env.local</code> (service role + SMTP encryption key). If send
            fails, read the error toast, check the Sending/Logs tab, the worker terminal, and spam. Not enough email
            credits? Add{" "}
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
          {!previewMode && !timer.planRunning ? (
            <p className="rounded-lg border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-sm text-amber-100/90">
              Sending requires an{" "}
              <strong className="font-medium text-amber-50">active server plan</strong>. Go to{" "}
              <strong>Wallet &amp; Plan</strong>, activate a plan, then return here to send.
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="inline-flex w-full min-w-[12rem] items-center justify-center gap-2 border-zinc-600 bg-zinc-950/50 text-zinc-100 hover:bg-zinc-900 sm:w-auto"
              disabled={previewLoading || previewMode}
              onClick={() => void handlePreviewEmail()}
            >
              {previewLoading ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                  Preview…
                </>
              ) : (
                <>
                  <Eye className="size-4 shrink-0" />
                  Preview Email
                </>
              )}
            </Button>
            <Button
              type="button"
              size="lg"
              className="inline-flex w-full min-w-[12rem] items-center justify-center gap-2 bg-emerald-600 text-white hover:bg-emerald-500 sm:w-auto"
              disabled={sending || previewMode || !timer.planRunning}
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
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Live preview</CardTitle>
          <CardDescription>
            What recipients will see. From / Subject / Body / Attachment update
            as you type. Merge tags (e.g. <code className="text-xs text-zinc-400">{"{{name}}"}</code>)
            are substituted with sample values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm">
            <div className="border-b border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm">
              <div className="flex items-baseline gap-3">
                <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  From
                </span>
                <span className="font-medium text-zinc-900">
                  {senderDisplay}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  To
                </span>
                <span className="text-zinc-700">
                  {previewToDisplay}
                  {campaignRecipients.length > 1 ? (
                    <span className="ml-2 text-xs text-zinc-500">
                      and {campaignRecipients.length - 1} more
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Subject
                </span>
                {previewSubject.trim() ? (
                  <span className="font-semibold text-zinc-900">
                    {previewSubject}
                  </span>
                ) : (
                  <span className="text-zinc-400 italic">(no subject)</span>
                )}
              </div>
              {attachmentMeta ? (
                <div className="mt-2 flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Attached
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700">
                    {attachmentMeta.icon === "pdf" ? (
                      <FileText className="size-3.5" />
                    ) : (
                      <ImageIcon className="size-3.5" />
                    )}
                    {attachmentMeta.filename}
                    <span className="text-zinc-400">·</span>
                    <span className="text-zinc-500">{attachmentMeta.label}</span>
                  </span>
                </div>
              ) : null}
            </div>
            <iframe
              key={`body-${bodyPreviewDoc.length}`}
              title="Email body preview"
              sandbox=""
              srcDoc={bodyPreviewDoc}
              className="block h-[420px] w-full border-0 bg-white"
            />
          </div>

          {attachmentMeta && attachmentPreviewDoc ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-2 text-sm font-medium text-zinc-100">
                  <Paperclip className="size-4 text-zinc-400" />
                  Attachment preview
                  <span className="text-xs font-normal text-zinc-500">
                    ({attachmentMeta.label})
                  </span>
                </h3>
                <span className="text-xs text-zinc-500">
                  Sent as <code className="text-zinc-300">{attachmentMeta.filename}</code>
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
                <iframe
                  key={`att-${attachmentPreviewDoc.length}`}
                  title="Attachment preview"
                  sandbox=""
                  srcDoc={attachmentPreviewDoc}
                  className="block h-[360px] w-full border-0 bg-white"
                />
              </div>
              <p className="text-xs text-zinc-500">
                {attachmentMeta.icon === "pdf"
                  ? "On send, this HTML is rendered to A4 PDF per recipient."
                  : `On send, this HTML is rendered to a ${attachmentMeta.label.toLowerCase()} per recipient.`}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={previewOpen}
        onOpenChange={(o) => {
          setPreviewOpen(o);
          if (!o) {
            setPreviewHtmlMerged(null);
            setPreviewMeta(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Email preview</DialogTitle>
          </DialogHeader>
          {previewMeta && previewHtmlMerged != null ? (
            <div className="space-y-4 text-sm">
              {previewMeta.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-amber-100/90">
                  {previewMeta.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              ) : null}
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Subject</p>
                <p className="mt-1 font-medium text-zinc-100">{applyMergePreview(previewMeta.subject, previewRow)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">To</p>
                <p className="mt-1 text-zinc-200">{previewMeta.previewTo}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">From</p>
                <p className="mt-1 text-zinc-200">{previewMeta.senderName}</p>
              </div>
              {previewMeta.attachmentNames.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Attachments</p>
                  <ul className="mt-1 list-inside list-disc text-zinc-300">
                    {previewMeta.attachmentNames.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="rounded-lg border border-zinc-800 bg-white p-4 text-zinc-900">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Rendered HTML
                </p>
                <div
                  className="max-w-none text-left text-sm leading-relaxed text-zinc-900 [&_a]:text-blue-600 [&_p]:my-2 [&_pre]:whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: previewHtmlMerged }}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPreviewOpen(false);
                setPreviewHtmlMerged(null);
                setPreviewMeta(null);
              }}
            >
              Edit
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 hover:bg-emerald-500"
              onClick={() => {
                setPreviewOpen(false);
                setPreviewHtmlMerged(null);
                setPreviewMeta(null);
                void handleSend();
              }}
            >
              Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
