import "server-only";

import { htmlToPlainText } from "@/lib/html-email";
import { extractPdfTextFromBuffer } from "@/lib/pdf-extract";
import type { GenuinenessAttachmentInput } from "@/lib/content-genuineness/types";

export {
  checkAttachmentContent,
  checkBodyAttachmentRelevance,
} from "@/lib/content-genuineness/attachment-checks";

async function extractAttachmentPlain(
  att: GenuinenessAttachmentInput,
): Promise<{ text: string; source: string }> {
  if (att.htmlText && att.htmlText.trim()) {
    return { text: htmlToPlainText(att.htmlText).trim(), source: att.filename || "html-attachment" };
  }
  const b64 = att.contentBase64?.trim() ?? "";
  if (!b64) return { text: "", source: att.filename || "attachment" };

  const name = (att.filename || "").toLowerCase();
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return { text: "", source: att.filename || "attachment" };
  }

  if (name.endsWith(".pdf") || buf.subarray(0, 5).toString("utf8") === "%PDF-") {
    try {
      const text = (await extractPdfTextFromBuffer(buf)).trim();
      return { text, source: att.filename || "attachment.pdf" };
    } catch {
      return { text: "", source: att.filename || "attachment.pdf" };
    }
  }

  if (name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".html") || name.endsWith(".htm")) {
    return { text: buf.toString("utf8").trim(), source: att.filename };
  }

  return { text: "", source: att.filename || "attachment" };
}

export async function collectAttachmentTexts(
  attachments: GenuinenessAttachmentInput[] | undefined,
): Promise<{ combined: string; perFile: { filename: string; text: string }[] }> {
  const list = attachments ?? [];
  const perFile: { filename: string; text: string }[] = [];
  for (const att of list) {
    const { text, source } = await extractAttachmentPlain(att);
    if (text) perFile.push({ filename: source, text });
  }
  return {
    combined: perFile.map((p) => p.text).join("\n\n"),
    perFile,
  };
}
