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
import {
  DEFAULT_BUILT_IN_MERGE_TAGS,
  generateBuiltInFieldsForRecipient,
  type BuiltInMergeTagConfig,
} from "@/lib/built-in-merge-tags";
import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import { parsedCsvToRecipientRows } from "@/lib/csv-recipients";
import type { ParsedCsv } from "@/lib/csv-types";

/** Used by the compose preview when no CSV is loaded. */
export const PREVIEW_MOCK_RECIPIENT: RecipientRow = {
  email: "john@example.com",
  name: "John Doe",
};

/**
 * Build a preview recipient from the most recently parsed CSV. We pick the
 * first valid (non-duplicate, non-invalid) row so arbitrary merge tags such
 * as `{{{city}}}` substitute with real values the user can recognise. When
 * no CSV is loaded we use a mock email with generated built-in tag values.
 */
export function buildPreviewRecipient(
  parsed: ParsedCsv | null,
  builtInTags: BuiltInMergeTagConfig[] = DEFAULT_BUILT_IN_MERGE_TAGS,
): RecipientRow {
  if (!parsed || parsed.rows.length === 0) {
    const email = PREVIEW_MOCK_RECIPIENT.email;
    return {
      ...PREVIEW_MOCK_RECIPIENT,
      fields: generateBuiltInFieldsForRecipient(email, builtInTags),
    };
  }
  const rows = parsedCsvToRecipientRows(parsed, builtInTags);
  return rows[0] ?? PREVIEW_MOCK_RECIPIENT;
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

export function htmlToPlainText(html: string): string {
  if (!html || !html.trim()) return "";
  try {
    return libHtmlToText(html, {
      wordwrap: 130,
      selectors: [
        { selector: "img", options: { linkBrackets: false } },
        { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      ],
    }).trim();
  } catch {
    return html.replace(/<[^>]+>/g, "").trim();
  }
}

export function applyMergePreview(
  template: string,
  row: RecipientRow = PREVIEW_MOCK_RECIPIENT,
  options?: { missingFormat?: "html" | "plain" },
): string {
  return applyMergeTags(template ?? "", row, options);
}
