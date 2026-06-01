/**
 * Helpers for the "HTML is primary, text auto-generated" compose model.
 *
 * - `sanitizeEmailHtml(html)` strips script/style/iframe/on*= handlers and `javascript:` URLs.
 *   Recipients' email clients block scripts anyway, but we strip them defense-in-depth so
 *   the stored message is also safe to render in a preview.
 * - `htmlToPlainText(html)` produces a plain-text fallback from HTML using `html-to-text`.
 * - `applyMergePreview(s)` renders merge tags with mock data for the live preview only.
 */
import { htmlToText as libHtmlToText } from "html-to-text";
import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import type { ParsedCsv } from "@/lib/csv-types";

/** Used by the compose preview to render {{{name}}} / {{name}} with plausible values. */
export const PREVIEW_MOCK_RECIPIENT: RecipientRow = {
  email: "john@example.com",
  name: "John Doe",
  c3: "ACME-123",
  c4: "Premium",
  c5: "2026-04-24",
  c6: "NY",
};

/**
 * Build a preview recipient from the most recently parsed CSV. We pick the
 * first valid (non-duplicate, non-invalid) row so arbitrary merge tags such
 * as `{{{city}}}` substitute with real values the user can recognise. When
 * no CSV is loaded we fall back to {@link PREVIEW_MOCK_RECIPIENT}.
 */
export function buildPreviewRecipient(parsed: ParsedCsv | null): RecipientRow {
  if (!parsed || parsed.rows.length === 0) return PREVIEW_MOCK_RECIPIENT;
  const firstValid =
    parsed.rows.find((r) => !r.invalidEmail && !r.duplicate) ?? parsed.rows[0];
  if (!firstValid) return PREVIEW_MOCK_RECIPIENT;

  const cells = firstValid.cells;
  const emailKey =
    parsed.columnOrder.find((c) => c.trim().toLowerCase() === "email") ?? "email";

  const lookupReserved = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = (cells[k] ?? "").trim();
      if (v) return v;
    }
    return undefined;
  };

  const fields: Record<string, string> = {};
  for (const col of parsed.columnOrder) {
    if (col === emailKey) continue;
    const v = (cells[col] ?? "").trim();
    if (!v) continue;
    fields[col] = v;
  }

  return {
    email:
      (cells[emailKey] ?? "").trim().toLowerCase() || PREVIEW_MOCK_RECIPIENT.email,
    name: lookupReserved("name", "Name") ?? PREVIEW_MOCK_RECIPIENT.name,
    c3: lookupReserved("c3", "C3") ?? PREVIEW_MOCK_RECIPIENT.c3,
    c4: lookupReserved("c4", "C4") ?? PREVIEW_MOCK_RECIPIENT.c4,
    c5: lookupReserved("c5", "C5") ?? PREVIEW_MOCK_RECIPIENT.c5,
    c6: lookupReserved("c6", "C6") ?? PREVIEW_MOCK_RECIPIENT.c6,
    fields: Object.keys(fields).length > 0 ? fields : undefined,
  };
}

/** Elements whose *contents* must be removed entirely (not just the tags). */
const CONTENT_STRIPPED_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
];

/** Like body sanitizer but keeps `<style>` so PDF/PNG renders match user CSS. */
const ATTACHMENT_STRIPPED_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
];

/** Minimal, fast HTML sanitizer targeted at authored email templates (not untrusted UGC). */
export function sanitizeEmailHtml(input: string): string {
  if (!input) return "";
  let html = String(input);

  for (const tag of CONTENT_STRIPPED_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    html = html.replace(re, "");
    // Unclosed variants: <script ...>
    const reOpen = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    html = html.replace(reOpen, "");
  }

  // Drop inline event handlers like onclick="…", onerror='…'
  html = html.replace(/\son[a-z]+\s*=\s*"(?:[^"\\]|\\.)*"/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*'(?:[^'\\]|\\.)*'/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // Neutralise javascript: and vbscript: URL schemes
  html = html.replace(/(href|src|xlink:href)\s*=\s*"(?:\s*)(javascript|vbscript):[^"]*"/gi, '$1="#"');
  html = html.replace(/(href|src|xlink:href)\s*=\s*'(?:\s*)(javascript|vbscript):[^']*'/gi, "$1='#'");

  return html;
}

/**
 * Sanitize HTML that will be rendered to PDF/PNG in Puppeteer — removes dangerous tags but
 * preserves inline and `<style>` blocks for layout.
 */
export function sanitizeAttachmentRenderHtml(input: string): string {
  if (!input) return "";
  let html = String(input);
  for (const tag of ATTACHMENT_STRIPPED_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    html = html.replace(re, "");
    const reOpen = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    html = html.replace(reOpen, "");
  }
  html = html.replace(/\son[a-z]+\s*=\s*"(?:[^"\\]|\\.)*"/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*'(?:[^'\\]|\\.)*'/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  html = html.replace(/(href|src|xlink:href)\s*=\s*"(?:\s*)(javascript|vbscript):[^"]*"/gi, '$1="#"');
  html = html.replace(/(href|src|xlink:href)\s*=\s*'(?:\s*)(javascript|vbscript):[^']*'/gi, "$1='#'");
  return html;
}

/** Convert an HTML body into a plain-text fallback suitable for the `text` MIME part. */
export function htmlToPlainText(html: string): string {
  if (!html || !html.trim()) return "";
  try {
    // Keep image alt text in the plain-text body. Yahoo / Spamassassin both
    // penalise image-only emails with empty text parts; surfacing alt copy
    // gives recipients (and filters) something readable to score.
    return libHtmlToText(html, {
      wordwrap: 130,
      selectors: [
        { selector: "img", options: { linkBrackets: false } },
        { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      ],
    }).trim();
  } catch {
    // Extremely defensive — html-to-text should not throw for strings, but fall back safely.
    return html.replace(/<[^>]+>/g, "").trim();
  }
}

/**
 * Live-preview: substitute merge tags using plausible mock values (no actual
 * send). When `row` is omitted the static {@link PREVIEW_MOCK_RECIPIENT} is
 * used; pass {@link buildPreviewRecipient}'s output to render with values
 * from the user's uploaded CSV instead.
 */
export function applyMergePreview(
  template: string,
  row: RecipientRow = PREVIEW_MOCK_RECIPIENT,
  options?: { missingFormat?: "html" | "plain" },
): string {
  return applyMergeTags(template ?? "", row, options);
}
