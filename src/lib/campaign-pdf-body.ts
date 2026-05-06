import "server-only";

export const PDF_EXTRACT_MAX_LENGTH = 20_000;

export function escapeHtmlForEmail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function truncatePdfExtractText(text: string): { text: string; truncated: boolean } {
  const t = text.trim();
  if (t.length <= PDF_EXTRACT_MAX_LENGTH) return { text: t, truncated: false };
  return {
    text: `${t.slice(0, PDF_EXTRACT_MAX_LENGTH)}\n\n[Content truncated]`,
    truncated: true,
  };
}

export function appendPdfExtractSectionToHtml(
  sanitizedUserHtml: string,
  preEscapedContent: string,
  opts: { truncated?: boolean; emptyNotice?: boolean } = {},
): string {
  const truncNote = opts.truncated
    ? '<p style="margin:0 0 0.75rem 0;font-size:0.875em;color:#666;"><em>Content was truncated for email size.</em></p>'
    : "";
  const body = opts.emptyNotice
    ? "<p><em>No readable text found in PDF.</em></p>"
    : `<pre style="white-space: pre-wrap; font-family: inherit;">${preEscapedContent}</pre>`;
  return `${sanitizedUserHtml}<br><br><hr><strong>Extracted Content from PDF:</strong>${truncNote}${body}`;
}
