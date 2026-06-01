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
import type { CustomMergeTag } from "@/lib/custom-merge-tags";
import { customTagsToFieldDefaults } from "@/lib/custom-merge-tags";
import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import { parsedCsvToRecipientRows } from "@/lib/csv-recipients";
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
export function buildPreviewRecipient(
  parsed: ParsedCsv | null,
  customTags: CustomMergeTag[] = [],
): RecipientRow {
  if (!parsed || parsed.rows.length === 0) {
    if (customTags.length === 0) return PREVIEW_MOCK_RECIPIENT;
    const defaults = customTagsToFieldDefaults(customTags);
    return {
      email: PREVIEW_MOCK_RECIPIENT.email,
      name: defaults.name ?? defaults.Name ?? PREVIEW_MOCK_RECIPIENT.name,
      c3: defaults.c3 ?? defaults.C3 ?? PREVIEW_MOCK_RECIPIENT.c3,
      c4: defaults.c4 ?? defaults.C4 ?? PREVIEW_MOCK_RECIPIENT.c4,
      c5: defaults.c5 ?? defaults.C5 ?? PREVIEW_MOCK_RECIPIENT.c5,
      c6: defaults.c6 ?? defaults.C6 ?? PREVIEW_MOCK_RECIPIENT.c6,
      fields: Object.keys(defaults).length > 0 ? defaults : undefined,
    };
  }
  const rows = parsedCsvToRecipientRows(parsed, customTags);
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
