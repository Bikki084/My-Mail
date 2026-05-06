/**
 * Inline attachments stored in `campaigns.attachment_paths` as JSON:
 * `[{ "filename": "x.pdf", "contentBase64": "..." }]`
 */
import type { Attachment } from "nodemailer/lib/mailer";

export type CampaignInlineAttachment = {
  filename: string;
  contentBase64: string;
};

/**
 * Coerce DB / PostgREST `jsonb` into an array. Some drivers or edge cases return a JSON string
 * instead of a parsed array, which would make `Array.isArray` fail and drop all attachments.
 */
function normalizeToAttachmentList(raw: unknown): unknown[] {
  if (raw == null) return [];
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return [];
    }
  }
  if (Array.isArray(v)) return v;
  return [];
}

function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

function stripDataUrlIfPresent(s: string): string {
  const t = s.replace(/\s/g, "");
  const i = t.indexOf("base64,");
  if (i === -1) return t;
  return t.slice(i + 7);
}

export function nodemailerAttachmentsFromCampaignField(
  raw: unknown,
): Attachment[] | undefined {
  const list = normalizeToAttachmentList(raw);
  const out: Attachment[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const filenameRaw =
      typeof o.filename === "string"
        ? o.filename
        : typeof o.name === "string"
          ? o.name
          : null;
    const b64Raw =
      typeof o.contentBase64 === "string"
        ? o.contentBase64
        : typeof o.content_base64 === "string"
          ? o.content_base64
          : null;
    if (!filenameRaw || b64Raw == null) continue;
    if (b64Raw.length < 1) continue;
    const filename = filenameRaw.slice(0, 200);
    const b64 = stripDataUrlIfPresent(b64Raw);
    if (!b64) continue;
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0) continue;
    // Nodemailer normalises Buffer → base64 in mail-message.js; keep a Buffer here.
    out.push({
      filename,
      content: buf,
      contentType: guessContentType(filename),
      contentDisposition: "attachment",
      contentTransferEncoding: "base64",
    });
  }
  return out.length ? out : undefined;
}
