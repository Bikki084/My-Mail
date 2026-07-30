import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import { sanitizeAttachmentRenderHtml } from "@/lib/html-email";
import {
  launchRenderBrowser,
  renderHtmlToJpegBuffer,
  renderHtmlToPdfBuffer,
  renderHtmlToPngBuffer,
} from "@/lib/html-attachment-render";

export type ActivityAttachmentMeta = {
  filename: string;
  sizeBytes: number;
  contentType: string;
  downloadDataUrl: string;
  /** Inline preview in admin modal (PDF / image). */
  previewable: boolean;
};

type HtmlAttachmentKind = "pdf" | "png" | "jpeg" | "pdf_image";
type HtmlAttachmentSpec = { kind: HtmlAttachmentKind; html: string };

function parseHtmlAttachment(raw: unknown): HtmlAttachmentSpec | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    o.kind !== "pdf" &&
    o.kind !== "png" &&
    o.kind !== "jpeg" &&
    o.kind !== "pdf_image"
  ) {
    return null;
  }
  const html = typeof o.html === "string" ? o.html.trim() : "";
  if (!html) return null;
  return { kind: o.kind, html };
}

function htmlAttachmentMeta(kind: HtmlAttachmentKind): {
  filename: string;
  contentType: string;
} {
  switch (kind) {
    case "pdf":
      return { filename: "attachment.pdf", contentType: "application/pdf" };
    case "jpeg":
      return { filename: "attachment.jpg", contentType: "image/jpeg" };
    case "pdf_image":
      return { filename: "attachment.png", contentType: "image/png" };
    case "png":
    default:
      return { filename: "attachment.png", contentType: "image/png" };
  }
}

function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

function isPreviewableContentType(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

function stripDataUrlIfPresent(s: string): string {
  const t = s.replace(/\s/g, "");
  const i = t.indexOf("base64,");
  if (i === -1) return t;
  return t.slice(i + 7);
}

function normalizeAttachmentList(raw: unknown): unknown[] {
  if (raw == null) return [];
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
}

function staticAttachmentsFromPaths(raw: unknown): ActivityAttachmentMeta[] {
  const out: ActivityAttachmentMeta[] = [];
  for (const item of normalizeAttachmentList(raw)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const filename =
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
    if (!filename || !b64Raw) continue;
    const b64 = stripDataUrlIfPresent(b64Raw);
    if (!b64) continue;
    let sizeBytes = 0;
    try {
      sizeBytes = Buffer.from(b64, "base64").length;
    } catch {
      continue;
    }
    const contentType = guessContentType(filename);
    out.push({
      filename: filename.slice(0, 200),
      sizeBytes,
      contentType,
      downloadDataUrl: `data:${contentType};base64,${b64}`,
      previewable: isPreviewableContentType(contentType),
    });
  }
  return out;
}

function pushRenderedAttachment(
  out: ActivityAttachmentMeta[],
  kind: HtmlAttachmentKind,
  buf: Buffer,
): void {
  const meta = htmlAttachmentMeta(kind);
  const b64 = buf.toString("base64");
  out.push({
    filename: meta.filename,
    sizeBytes: buf.length,
    contentType: meta.contentType,
    downloadDataUrl: `data:${meta.contentType};base64,${b64}`,
    previewable: true,
  });
}

/**
 * Build attachment list for admin sample-mail preview, including rendered
 * HTML attachments (PDF/PNG/JPEG) the same way the send worker does.
 */
export async function buildActivityAttachmentsPreview(
  attachmentPathsRaw: unknown,
  htmlAttachmentRaw: unknown,
  sampleRecipient: RecipientRow,
): Promise<ActivityAttachmentMeta[]> {
  const out = staticAttachmentsFromPaths(attachmentPathsRaw);

  const htmlAtt = parseHtmlAttachment(htmlAttachmentRaw);
  if (!htmlAtt) return out;

  const merged = applyMergeTags(
    sanitizeAttachmentRenderHtml(htmlAtt.html),
    sampleRecipient,
    { missingFormat: "html" },
  );

  let browser;
  try {
    browser = await launchRenderBrowser();
    const buf =
      htmlAtt.kind === "pdf"
        ? await renderHtmlToPdfBuffer(browser, merged)
        : htmlAtt.kind === "jpeg"
          ? await renderHtmlToJpegBuffer(browser, merged)
          : await renderHtmlToPngBuffer(browser, merged);
    pushRenderedAttachment(out, htmlAtt.kind, buf);
  } catch (e) {
    console.error("[user-activity] html attachment render failed:", e);
  } finally {
    await browser?.close().catch(() => {});
  }

  return out;
}
