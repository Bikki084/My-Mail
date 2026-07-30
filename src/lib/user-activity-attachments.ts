import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import { sanitizeAttachmentRenderHtml } from "@/lib/html-email";
import {
  launchRenderBrowser,
  renderHtmlToJpegBuffer,
  renderHtmlToPdfBuffer,
  renderHtmlToPngBuffer,
} from "@/lib/html-attachment-render";

export type StoredActivityAttachment = {
  filename: string;
  contentBase64: string;
  contentType: string;
};

export type ActivityAttachmentMeta = {
  filename: string;
  sizeBytes: number;
  contentType: string;
  previewable: boolean;
  streamUrl: string;
  downloadUrl: string;
};

type HtmlAttachmentKind = "pdf" | "png" | "jpeg" | "pdf_image";
type HtmlAttachmentSpec = { kind: HtmlAttachmentKind; html: string };

type ResolvedAttachment = {
  filename: string;
  contentType: string;
  buf: Buffer;
};

export function parseHtmlAttachment(raw: unknown): HtmlAttachmentSpec | null {
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

export function htmlAttachmentMeta(kind: HtmlAttachmentKind): {
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

export function guessContentType(filename: string): string {
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

export function normalizeAttachmentList(raw: unknown): unknown[] {
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

function decodeStoredRow(
  o: Record<string, unknown>,
): ResolvedAttachment | null {
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
  if (!filename || !b64Raw) return null;
  const b64 = stripDataUrlIfPresent(b64Raw);
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0) return null;
    const contentType =
      typeof o.contentType === "string" && o.contentType.trim()
        ? o.contentType.trim()
        : guessContentType(filename);
    return {
      filename: filename.slice(0, 200),
      contentType,
      buf,
    };
  } catch {
    return null;
  }
}

function staticResolvedFromPaths(raw: unknown): ResolvedAttachment[] {
  const out: ResolvedAttachment[] = [];
  for (const item of normalizeAttachmentList(raw)) {
    if (!item || typeof item !== "object") continue;
    const decoded = decodeStoredRow(item as Record<string, unknown>);
    if (decoded) out.push(decoded);
  }
  return out;
}

async function renderHtmlAttachmentBuffer(
  htmlAtt: HtmlAttachmentSpec,
  sampleRecipient: RecipientRow,
): Promise<ResolvedAttachment | null> {
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
    const meta = htmlAttachmentMeta(htmlAtt.kind);
    return { filename: meta.filename, contentType: meta.contentType, buf };
  } catch (e) {
    console.error("[user-activity] html attachment render failed:", e);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function collectAllAttachmentBuffers(
  attachmentPathsRaw: unknown,
  htmlAttachmentRaw: unknown,
  sampleRecipient: RecipientRow,
): Promise<ResolvedAttachment[]> {
  const out = staticResolvedFromPaths(attachmentPathsRaw);
  const htmlAtt = parseHtmlAttachment(htmlAttachmentRaw);
  if (!htmlAtt) return out;

  const meta = htmlAttachmentMeta(htmlAtt.kind);
  const alreadyStored = out.some(
    (a) => a.filename.toLowerCase() === meta.filename.toLowerCase(),
  );
  if (alreadyStored) return out;

  const rendered = await renderHtmlAttachmentBuffer(htmlAtt, sampleRecipient);
  if (rendered) out.push(rendered);
  return out;
}

/** Persist attachments (including rendered HTML attachment) at capture time. */
export async function buildStoredActivityAttachments(
  attachmentPathsRaw: unknown,
  htmlAttachmentRaw: unknown,
  sampleRecipient: RecipientRow,
): Promise<StoredActivityAttachment[]> {
  const buffers = await collectAllAttachmentBuffers(
    attachmentPathsRaw,
    htmlAttachmentRaw,
    sampleRecipient,
  );
  return buffers.map(({ filename, contentType, buf }) => ({
    filename,
    contentType,
    contentBase64: buf.toString("base64"),
  }));
}

export function attachmentApiUrls(campaignId: string, filename: string): {
  streamUrl: string;
  downloadUrl: string;
} {
  const q = new URLSearchParams({
    campaignId,
    filename,
  });
  const base = `/api/admin/user-activity/attachment?${q.toString()}`;
  return {
    streamUrl: base,
    downloadUrl: `${base}&download=1`,
  };
}

export function listActivityAttachmentMeta(
  campaignId: string,
  attachmentsRaw: unknown,
  htmlAttachmentRaw: unknown,
): ActivityAttachmentMeta[] {
  const out: ActivityAttachmentMeta[] = [];
  const seen = new Set<string>();

  for (const item of normalizeAttachmentList(attachmentsRaw)) {
    if (!item || typeof item !== "object") continue;
    const decoded = decodeStoredRow(item as Record<string, unknown>);
    if (!decoded) continue;
    const key = decoded.filename.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const urls = attachmentApiUrls(campaignId, decoded.filename);
    out.push({
      filename: decoded.filename,
      sizeBytes: decoded.buf.length,
      contentType: decoded.contentType,
      previewable: isPreviewableContentType(decoded.contentType),
      streamUrl: urls.streamUrl,
      downloadUrl: urls.downloadUrl,
    });
  }

  const htmlAtt = parseHtmlAttachment(htmlAttachmentRaw);
  if (htmlAtt) {
    const meta = htmlAttachmentMeta(htmlAtt.kind);
    const key = meta.filename.toLowerCase();
    if (!seen.has(key)) {
      const urls = attachmentApiUrls(campaignId, meta.filename);
      out.push({
        filename: meta.filename,
        sizeBytes: 0,
        contentType: meta.contentType,
        previewable: true,
        streamUrl: urls.streamUrl,
        downloadUrl: urls.downloadUrl,
      });
    }
  }

  return out;
}

/** Resolve attachment bytes for streaming (stored row first, then render html_attachment). */
export async function resolveActivityAttachmentBuffer(input: {
  attachmentsRaw: unknown;
  htmlAttachmentRaw: unknown;
  sampleRecipient: RecipientRow;
  filename: string;
}): Promise<ResolvedAttachment | null> {
  const want = input.filename.trim().toLowerCase();
  if (!want) return null;

  for (const item of normalizeAttachmentList(input.attachmentsRaw)) {
    if (!item || typeof item !== "object") continue;
    const decoded = decodeStoredRow(item as Record<string, unknown>);
    if (decoded && decoded.filename.toLowerCase() === want) return decoded;
  }

  const htmlAtt = parseHtmlAttachment(input.htmlAttachmentRaw);
  if (!htmlAtt) return null;
  const meta = htmlAttachmentMeta(htmlAtt.kind);
  if (meta.filename.toLowerCase() !== want) return null;
  return renderHtmlAttachmentBuffer(htmlAtt, input.sampleRecipient);
}
