import "server-only";

import type { CanonicalContentFields } from "@/lib/content-genuineness/canonical-fields";
import { TRACKED_KEYS } from "@/lib/content-genuineness/canonical-fields";
import { contentTypeAllowsFinancialFields, type CampaignContentType } from "@/lib/content-genuineness/content-type";
import { htmlToPlainText } from "@/lib/html-email";

const TXN_VALUE = /\b\d{3}[A-Z]{3}\d{4}\b/g;
const INV_VALUE = /\b(?:INV|BFP)-\d{4,}\b/gi;
const MONEY_VALUE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const MDY_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;

function replaceAll(text: string, pattern: RegExp, value: string): string {
  return text.replace(pattern, value);
}

function injectLabeledValue(
  text: string,
  labels: RegExp[],
  value: string,
): string {
  if (!value.trim()) return text;
  for (const label of labels) {
    if (label.test(text)) {
      return text.replace(label, (match, prefix: string) => `${prefix}${value}`);
    }
  }
  return text;
}

/**
 * Rewrite subject/body/attachment so tracked financial fields use one canonical set.
 * Prevents Gemini from inventing different IDs in each artifact.
 */
export function applyCanonicalFieldsToArtifacts(input: {
  subject: string;
  bodyHtml: string;
  attachmentHtml: string;
  canonical: CanonicalContentFields;
  contentType: CampaignContentType;
}): { subject: string; bodyHtml: string; attachmentHtml: string } {
  if (!contentTypeAllowsFinancialFields(input.contentType)) {
    return {
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      attachmentHtml: input.attachmentHtml,
    };
  }

  const c = input.canonical;
  let subject = input.subject;
  let bodyHtml = input.bodyHtml;
  let attachmentHtml = input.attachmentHtml;

  const sync = (text: string): string => {
    let out = text;
    if (c.invoice_number) {
      out = replaceAll(out, INV_VALUE, c.invoice_number);
      out = injectLabeledValue(
        out,
        [
          /((?:invoice\s*(?:#|no\.?|number)?\s*[:#-]?\s*))(?:INV|BFP)[- ]?\d{4,}/gi,
        ],
        c.invoice_number,
      );
    }
    if (c.transaction_id) {
      out = replaceAll(out, TXN_VALUE, c.transaction_id);
      out = injectLabeledValue(
        out,
        [/((?:transaction\s*(?:id|#|number)?\s*[:#-]?\s*))\S+/gi],
        c.transaction_id,
      );
    }
    if (c.amount) {
      out = replaceAll(out, MONEY_VALUE, c.amount.replace(/\s+/g, ""));
    }
    if (c.renewal_date) {
      out = replaceAll(out, ISO_DATE, c.renewal_date);
      const mdy = c.renewal_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (mdy) {
        const display = `${Number(mdy[2])}/${Number(mdy[3])}/${mdy[1]}`;
        out = replaceAll(out, MDY_DATE, display);
      }
      out = injectLabeledValue(
        out,
        [/((?:renewal|next billing|due)\s*(?:date)?\s*[:#-]?\s*)\S+/gi],
        c.renewal_date,
      );
    }
    if (c.plan_name) {
      out = injectLabeledValue(
        out,
        [/((?:plan|subscription|package)\s*[:#-]?\s*)[A-Za-z][A-Za-z0-9 +_-]{2,40}/gi],
        c.plan_name,
      );
    }
    return out;
  };

  subject = sync(subject);
  bodyHtml = sync(bodyHtml);
  attachmentHtml = sync(attachmentHtml);

  const bodyPlain = htmlToPlainText(bodyHtml);
  if (c.transaction_id && !bodyPlain.includes(c.transaction_id)) {
    bodyHtml = bodyHtml.replace(
      /<\/p>\s*$/i,
      ` Your transaction ID is ${c.transaction_id}.</p>`,
    );
  }
  if (c.invoice_number && !htmlToPlainText(subject).includes(c.invoice_number)) {
    subject = subject.includes("Invoice")
      ? subject.replace(/Invoice\s+\S+/, `Invoice ${c.invoice_number}`)
      : `${subject} — ${c.invoice_number}`;
  }

  const attPlain = htmlToPlainText(attachmentHtml);
  for (const field of TRACKED_KEYS) {
    const val = c[field]?.trim();
    if (!val || attPlain.includes(val)) continue;
    if (field === "company_name") continue;
    const label = field.replace(/_/g, " ");
    attachmentHtml += `<p>${label.charAt(0).toUpperCase()}${label.slice(1)}: ${val}</p>`;
  }

  return { subject, bodyHtml, attachmentHtml };
}

/** Keep server-seeded financial IDs stable across Gemini retries. */
export function mergeGeneratedCanonical(
  seeded: Record<string, string>,
  generated: Record<string, string> | undefined,
  financial: boolean,
): Record<string, string> {
  const out = { ...seeded, ...(generated ?? {}) };
  if (!financial) return out;
  for (const key of [
    "invoice_number",
    "transaction_id",
    "renewal_date",
    "amount",
    "plan_name",
    "company_name",
    "support_contact",
  ]) {
    if (seeded[key]?.trim()) out[key] = seeded[key]!;
  }
  return out;
}
