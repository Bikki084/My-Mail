import "server-only";

export const MAX_CAMPAIGN_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_CAMPAIGN_ATTACHMENTS = 5;

export type AttachmentRow = { filename: string; contentBase64: string };

export async function readPdfExtractFromForm(form: FormData): Promise<
  | { ok: true; kind: "absent" }
  | { ok: true; kind: "present"; buffer: Buffer; filename: string }
  | { ok: false; message: string }
> {
  const v = form.get("pdf_for_extract");
  if (v == null) return { ok: true, kind: "absent" };
  if (typeof v === "string") {
    if (v.trim() === "") return { ok: true, kind: "absent" };
    return { ok: false, message: "Invalid PDF upload." };
  }
  const blob = v as Blob;
  if (blob.size === 0) {
    return { ok: false, message: "Please upload a PDF file." };
  }
  if (blob.size > MAX_CAMPAIGN_ATTACHMENT_BYTES) {
    return {
      ok: false,
      message: `Each file must be at most ${MAX_CAMPAIGN_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
    };
  }
  const name =
    typeof File !== "undefined" && blob instanceof File && blob.name.length > 0
      ? blob.name
      : "document.pdf";
  if (!name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: "Please upload a PDF file." };
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  return { ok: true, kind: "present", buffer: buf, filename: name.slice(0, 200) };
}

/**
 * Only `files` form parts count as campaign attachments (not `pdf_for_extract`).
 */
export async function normalizedAttachmentsFromMultipart(
  form: FormData,
  expectedFileCount: number,
): Promise<
  | { ok: true; rows: AttachmentRow[] }
  | { ok: false; message: string }
> {
  const rows: AttachmentRow[] = [];
  let index = 0;
  for (const [key, value] of form.entries()) {
    if (key !== "files") continue;
    if (value == null) continue;
    if (typeof value === "string") continue;
    const p = value as globalThis.Blob;
    if (typeof p.size !== "number" || typeof p.arrayBuffer !== "function") {
      continue;
    }
    if (p.size > MAX_CAMPAIGN_ATTACHMENT_BYTES) {
      return {
        ok: false,
        message: `Each file must be at most ${MAX_CAMPAIGN_ATTACHMENT_BYTES / (1024 * 1024)} MB.`,
      };
    }
    if (p.size === 0) {
      return { ok: false, message: "Empty file is not allowed as an attachment." };
    }
    if (rows.length >= MAX_CAMPAIGN_ATTACHMENTS) {
      return { ok: false, message: `At most ${MAX_CAMPAIGN_ATTACHMENTS} files.` };
    }
    const buf = Buffer.from(await p.arrayBuffer());
    const name =
      typeof File !== "undefined" && p instanceof File && p.name.length > 0
        ? p.name
        : `attachment-${index + 1}.bin`;
    const filename = name.slice(0, 200);
    rows.push({ filename, contentBase64: buf.toString("base64") });
    index += 1;
  }
  if (expectedFileCount > 0 && rows.length === 0) {
    return {
      ok: false,
      message:
        "The server did not receive any file data. The upload may be blocked, truncated, or the request format is wrong. Try a smaller file or a different network.",
    };
  }
  if (expectedFileCount > 0 && rows.length !== expectedFileCount) {
    return {
      ok: false,
      message: `Expected ${expectedFileCount} file part(s) but the form contained ${rows.length}. Check your network or try again.`,
    };
  }
  return { ok: true, rows };
}
