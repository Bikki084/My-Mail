import type { RecipientRow } from "@/lib/merge-tags";
import { coerceEncodingInput } from "@/lib/mail-encoding";

function formatApiError(j: { error?: unknown }): string {
  const e = j.error;
  if (e == null) return "Request failed";
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

export type HtmlAttachmentKind = "pdf" | "png" | "jpeg" | "pdf_image";
export type HtmlAttachmentPayload = { kind: HtmlAttachmentKind; html: string };

export type PreviewCampaignOk = {
  finalHtml: string;
  warnings: string[];
  truncated: boolean;
  subject: string;
  senderName: string;
  previewTo: string;
  attachmentNames: string[];
};

/**
 * Build the same HTML the server would store (sanitise). Requires session.
 */
export async function previewCampaignEmail(options: {
  subject: string;
  senderName: string;
  bodyHtml: string;
  encoding: string;
  previewTo: string;
  attachmentNames: string[];
  htmlAttachment?: HtmlAttachmentPayload | null;
}): Promise<{ ok: true; data: PreviewCampaignOk } | { ok: false; error: string }> {
  const enc = coerceEncodingInput(options.encoding);
  const fd = new FormData();
  fd.append(
    "payload",
    JSON.stringify({
      subject: options.subject,
      sender_name: options.senderName,
      body_html: options.bodyHtml,
      encoding: enc,
      preview_to: options.previewTo,
      attachment_names: options.attachmentNames,
      html_attachment:
        options.htmlAttachment?.html?.trim() ? options.htmlAttachment : undefined,
    }),
  );
  const res = await fetch("/api/campaigns/preview", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const j = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    finalHtml?: string;
    warnings?: string[];
    truncated?: boolean;
    subject?: string;
    senderName?: string;
    previewTo?: string;
    attachmentNames?: string[];
  };
  if (!res.ok) {
    return { ok: false, error: formatApiError(j) };
  }
  if (typeof j.finalHtml !== "string") {
    return { ok: false, error: "Invalid preview response" };
  }
  return {
    ok: true,
    data: {
      finalHtml: j.finalHtml,
      warnings: Array.isArray(j.warnings) ? j.warnings : [],
      truncated: Boolean(j.truncated),
      subject: typeof j.subject === "string" ? j.subject : "—",
      senderName: typeof j.senderName === "string" ? j.senderName : "—",
      previewTo: typeof j.previewTo === "string" ? j.previewTo : "john@example.com",
      attachmentNames: Array.isArray(j.attachmentNames) ? j.attachmentNames : [],
    },
  };
}

export type QueueCampaignOptions = {
  streamName: string;
  subject: string;
  senderName: string;
  /** Only HTML is accepted. The server sanitises it and auto-generates the text fallback. */
  bodyHtml: string;
  encoding: string;
  recipients: RecipientRow[];
  /**
   * When set (recommended from the Email Composer), stored on the campaign so delivery
   * uses exactly these SMTP rows — same snapshot as "Saved SMTP servers" at send time.
   * Omit for tests / API clients that want "all servers for this user" (empty array on insert).
   */
  smtpServerIds?: string[];
  /** Stored on the campaign; defaults to `round_robin` (even blocks per SMTP). */
  rotationStrategy?: "round_robin" | "random" | "threshold" | "alternating";
  /**
   * Stored on the campaign; rendered to PDF or PNG per recipient when sent.
   */
  htmlAttachment?: HtmlAttachmentPayload | null;
  /**
   * Legacy JSON+base64 path (e.g. tests). Prefer omitting from the browser composer.
   */
  attachments?: { filename: string; contentBase64: string }[];
};

/**
 * Create campaign and either queue a BullMQ job (Redis) or deliver immediately (no Redis).
 * Requires authenticated session (cookies).
 */
export type CampaignSendMode = "queued" | "started" | "delivered";

export async function queueCampaignSend(
  options: QueueCampaignOptions,
): Promise<
  | { ok: true; campaignId: string; mode: CampaignSendMode; warnings?: string[] }
  | { ok: false; error: string }
> {
  const need = options.recipients.length;
  if (need === 0) {
    return { ok: false, error: "No recipients. Upload a valid CSV on the Recipients tab." };
  }
  const enc = coerceEncodingInput(options.encoding);
  const nAttachLegacy = options.attachments?.length ?? 0;
  const hasHtmlAttachment = Boolean(options.htmlAttachment?.html?.trim());
  const useMultipart = nAttachLegacy > 0;
  const smtpPayload =
    options.smtpServerIds && options.smtpServerIds.length > 0
      ? {
          smtp_server_ids: options.smtpServerIds,
          ...(options.rotationStrategy
            ? { rotation_strategy: options.rotationStrategy }
            : {}),
        }
      : options.rotationStrategy
        ? { rotation_strategy: options.rotationStrategy }
        : {};

  let create: Response;
  if (useMultipart) {
    const fd = new FormData();
    fd.append(
      "payload",
      JSON.stringify({
        stream_name: options.streamName,
        subject: options.subject,
        sender_name: options.senderName,
        body_html: options.bodyHtml,
        encoding: enc,
        recipients: options.recipients,
        html_attachment: hasHtmlAttachment ? options.htmlAttachment : undefined,
        ...smtpPayload,
      }),
    );
    create = await fetch("/api/campaigns", {
      method: "POST",
      credentials: "include",
      body: fd,
      headers: {
        "X-Mymail-Expected-Files": String(nAttachLegacy),
        "X-Mymail-Intent": "send",
      },
    });
  } else {
    create = await fetch("/api/campaigns", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Mymail-Intent": "send",
      },
      body: JSON.stringify({
        stream_name: options.streamName,
        subject: options.subject,
        sender_name: options.senderName,
        body_html: options.bodyHtml,
        encoding: enc,
        recipients: options.recipients,
        attachments: options.attachments,
        html_attachment: hasHtmlAttachment ? options.htmlAttachment : undefined,
        ...smtpPayload,
      }),
    });
  }
  const cj = (await create.json().catch(() => ({}))) as {
    id?: string;
    error?: unknown;
    attachmentCount?: number;
    warnings?: string[];
  };
  if (!create.ok) {
    return { ok: false, error: formatApiError(cj) };
  }
  if (!cj.id) {
    return { ok: false, error: "No campaign id returned" };
  }
  if (useMultipart) {
    const want = nAttachLegacy;
    const got = cj.attachmentCount ?? 0;
    if (want > 0 && got !== want) {
      return {
        ok: false,
        error: `The server stored ${got} attachment(s) but ${want} were sent. The upload was incomplete — try a smaller file or a different network.`,
      };
    }
  }
  const sendCampaign = async (
    id: string,
    init?: RequestInit,
  ): Promise<Response> =>
    fetch(`/api/campaigns/${id}/send`, {
      method: "POST",
      credentials: "include",
      ...init,
      // 30s is plenty: the route returns as soon as the campaign is marked
      // `sending` (background delivery) or queued (Redis). It no longer waits
      // for SMTP/Puppeteer to finish, so we don't need the old 60s budget.
      signal: AbortSignal.timeout(30_000),
    });

  let go: Response;
  try {
    go = await sendCampaign(cj.id);
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "TimeoutError"
        ? "Send request timed out after 30s. The server is taking unusually long to start delivery — check the dev terminal for errors, then try again."
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, error: msg };
  }
  const gj = (await go.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    mode?: CampaignSendMode;
  };
  if (!go.ok) {
    return {
      ok: false,
      error: typeof gj.error === "string" ? gj.error : formatApiError(gj as { error?: unknown }),
    };
  }
  const mode: CampaignSendMode =
    gj.mode === "delivered"
      ? "delivered"
      : gj.mode === "started"
        ? "started"
        : "queued";
  return {
    ok: true,
    campaignId: cj.id,
    mode,
    warnings: Array.isArray(cj.warnings) ? cj.warnings : undefined,
  };
}
