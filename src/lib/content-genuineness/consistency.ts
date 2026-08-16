/**
 * Cross-check subject / body / attachment for phishing-like field mismatches.
 */

import { htmlToPlainText } from "@/lib/html-email";
import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import { resolveCanonicalCompanyName, textMentionsCompanyName } from "@/lib/brand";
import {
  TRACKED_KEYS,
  type CanonicalContentFields,
  type CanonicalFieldKey,
  extractDynamicFieldCandidates,
} from "@/lib/content-genuineness/canonical-fields";

export type ConsistencyMismatch = {
  field: CanonicalFieldKey;
  expected?: string;
  subject?: string | null;
  body?: string | null;
  attachment?: string | null;
  detail: string;
};

export type ConsistencyCheckResult =
  | { ok: true; bodyFields: Partial<Record<CanonicalFieldKey, string>>; attachmentFields: Partial<Record<CanonicalFieldKey, string>> }
  | { ok: false; mismatches: ConsistencyMismatch[]; bodyFields: Partial<Record<CanonicalFieldKey, string>>; attachmentFields: Partial<Record<CanonicalFieldKey, string>> };

function normalizeComparable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDateComparable(value: string): string {
  const t = value.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1]!.padStart(2, "0")}-${mdy[2]!.padStart(2, "0")}`;
  }
  return normalizeComparable(t);
}

function fieldMentioned(
  candidates: Partial<Record<CanonicalFieldKey, string[]>>,
  field: CanonicalFieldKey,
): string | null {
  const list = candidates[field];
  return list?.[0] ?? null;
}

function valuesConflict(a: string, b: string, field?: CanonicalFieldKey): boolean {
  if (!a.trim() || !b.trim()) return false;
  if (a.includes("{{{") || b.includes("{{{")) {
    return normalizeComparable(a) !== normalizeComparable(b);
  }
  if (field === "renewal_date") {
    return normalizeDateComparable(a) !== normalizeDateComparable(b);
  }
  return normalizeComparable(a) !== normalizeComparable(b);
}

function extractTrackedFields(text: string): Partial<Record<CanonicalFieldKey, string>> {
  const c = extractDynamicFieldCandidates(text);
  const out: Partial<Record<CanonicalFieldKey, string>> = {};
  for (const key of TRACKED_KEYS) {
    const v = fieldMentioned(c, key);
    if (v) out[key] = v;
  }
  return out;
}

function expandForCheck(htmlOrText: string, previewRecipient?: RecipientRow): string {
  if (!previewRecipient) return htmlOrText;
  return applyMergeTags(htmlOrText, previewRecipient, { missingFormat: "plain" });
}

/** Expand merge tags and extract plain text (same text a rendered PDF would contain). */
export function extractPersistedFieldSets(input: {
  subject: string;
  bodyHtml: string;
  attachmentHtml?: string | null;
  previewRecipient?: RecipientRow;
}): {
  bodyFields: Partial<Record<CanonicalFieldKey, string>>;
  attachmentFields: Partial<Record<CanonicalFieldKey, string>>;
  bodyPlain: string;
  attachmentPlain: string;
} {
  const expandedBody = expandForCheck(input.bodyHtml, input.previewRecipient);
  const expandedSubject = expandForCheck(input.subject, input.previewRecipient);
  const bodyPlain = htmlToPlainText(`${expandedSubject}\n${expandedBody}`).trim();

  const attHtml = (input.attachmentHtml ?? "").trim();
  const attachmentPlain = attHtml
    ? htmlToPlainText(expandForCheck(attHtml, input.previewRecipient)).trim()
    : "";

  return {
    bodyFields: extractTrackedFields(bodyPlain),
    attachmentFields: extractTrackedFields(attachmentPlain),
    bodyPlain,
    attachmentPlain,
  };
}

/**
 * HARD blocking gate on final persisted subject + body + attachment HTML.
 * Parses attachment via the same plain text path used before PDF render (and
 * optional PDF bytes when provided).
 */
export function assertFinalPersistedConsistency(input: {
  subject: string;
  bodyHtml: string;
  attachmentHtml?: string | null;
  attachmentPdfText?: string | null;
  senderName: string;
  previewRecipient?: RecipientRow;
}): ConsistencyCheckResult {
  const { bodyFields, attachmentFields, bodyPlain, attachmentPlain } =
    extractPersistedFieldSets(input);

  const attachmentText =
    (input.attachmentPdfText ?? "").trim() || attachmentPlain;
  const attFields =
    input.attachmentPdfText?.trim()
      ? { ...attachmentFields, ...extractTrackedFields(input.attachmentPdfText) }
      : attachmentFields;

  const mismatches: ConsistencyMismatch[] = [];
  const hasAttachment = Boolean((input.attachmentHtml ?? "").trim() || attachmentText);

  if (!hasAttachment) {
    return { ok: true, bodyFields, attachmentFields: attFields };
  }

  for (const field of TRACKED_KEYS) {
    const bodyVal = bodyFields[field] ?? null;
    const attVal = attFields[field] ?? null;

    if (bodyVal && attVal && valuesConflict(bodyVal, attVal, field)) {
      mismatches.push({
        field,
        body: bodyVal,
        attachment: attVal,
        detail: `${field} in email body ("${bodyVal}") does not match attachment/PDF ("${attVal}").`,
      });
      continue;
    }

    if (attVal && !bodyVal) {
      mismatches.push({
        field,
        body: bodyVal,
        attachment: attVal,
        detail: `${field} appears in attachment/PDF ("${attVal}") but is missing from the email body.`,
      });
      continue;
    }

    if (bodyVal && !attVal) {
      mismatches.push({
        field,
        body: bodyVal,
        attachment: attVal,
        detail: `${field} appears in email body ("${bodyVal}") but is missing from the attachment/PDF.`,
      });
    }
  }

  if (!bodyPlain || bodyPlain.split(/\s+/).filter(Boolean).length < 8) {
    mismatches.push({
      field: "company_name",
      detail: "Email body is too thin to verify against the attachment.",
    });
  }

  if (!attachmentText) {
    mismatches.push({
      field: "invoice_number",
      detail: "Attachment present but no parseable text could be extracted for consistency check.",
    });
  }

  const company = resolveCanonicalCompanyName(input.senderName);
  if (company && bodyPlain && attachmentText) {
    const combined = `${bodyPlain}\n${attachmentText}`;
    if (!textMentionsCompanyName(combined, company)) {
      mismatches.push({
        field: "company_name",
        body: company,
        detail: `company_name "${company}" is not mentioned in the email body or attachment.`,
      });
    }
  }

  const seen = new Set<string>();
  const unique = mismatches.filter((m) => {
    const k = `${m.field}:${m.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length > 0) {
    console.warn("[content-genuineness] final consistency BLOCKED", {
      bodyFields,
      attachmentFields: attFields,
      mismatches: unique,
    });
    return { ok: false, mismatches: unique, bodyFields, attachmentFields: attFields };
  }

  console.info("[content-genuineness] final consistency PASS", { bodyFields, attachmentFields: attFields });
  return { ok: true, bodyFields, attachmentFields: attFields };
}

/**
 * Assert tracked dynamic fields are identical across AI rewrite artifacts and canonical.
 */
export function assertCrossArtifactConsistency(input: {
  canonical: CanonicalContentFields;
  subject: string;
  bodyHtmlOrText: string;
  attachmentHtmlOrText: string | null | undefined;
}): ConsistencyCheckResult {
  const subjectC = extractDynamicFieldCandidates(input.subject);
  const bodyC = extractDynamicFieldCandidates(input.bodyHtmlOrText);
  const attText = (input.attachmentHtmlOrText ?? "").trim();
  const attC = attText ? extractDynamicFieldCandidates(attText) : {};

  const bodyFields = extractTrackedFields(input.bodyHtmlOrText);
  const attachmentFields = attText ? extractTrackedFields(attText) : {};

  const mismatches: ConsistencyMismatch[] = [];

  for (const field of TRACKED_KEYS) {
    const expected = input.canonical[field]?.trim() ?? "";
    if (!expected) continue;

    const subjectVal = fieldMentioned(subjectC, field);
    const bodyVal = fieldMentioned(bodyC, field);
    const attVal = attText ? fieldMentioned(attC, field) : null;

    const present = [
      ["subject", subjectVal],
      ["body", bodyVal],
      ["attachment", attVal],
    ] as const;
    const nonNull = present.filter(([, v]) => v);
    if (nonNull.length >= 2) {
      const first = nonNull[0]![1]!;
      for (let i = 1; i < nonNull.length; i++) {
        const [, v] = nonNull[i]!;
        if (v && valuesConflict(first, v, field)) {
          mismatches.push({
            field,
            expected,
            subject: subjectVal,
            body: bodyVal,
            attachment: attVal,
            detail: `${field} differs across subject/body/attachment (phishing inconsistency).`,
          });
          break;
        }
      }
    }

    for (const [where, v] of present) {
      if (!v) continue;
      if (valuesConflict(expected, v, field)) {
        mismatches.push({
          field,
          expected,
          subject: subjectVal,
          body: bodyVal,
          attachment: attVal,
          detail: `${field} in ${where} ("${v}") does not match canonical ("${expected}").`,
        });
      }
    }
  }

  const final = assertFinalPersistedConsistency({
    subject: input.subject,
    bodyHtml: input.bodyHtmlOrText,
    attachmentHtml: attText,
    senderName: input.canonical.company_name,
  });
  if (!final.ok) {
    mismatches.push(...final.mismatches);
  }

  const seen = new Set<string>();
  const unique = mismatches.filter((m) => {
    const k = `${m.field}:${m.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return unique.length === 0
    ? { ok: true, bodyFields, attachmentFields }
    : { ok: false, mismatches: unique, bodyFields, attachmentFields };
}

/** Post-check for phishing tone / missing support / generic greeting. */
export function assertPhishingIndicatorSanity(input: {
  canonical: CanonicalContentFields;
  subject: string;
  bodyHtmlOrText: string;
  mergeTags?: string[];
}): { ok: true } | { ok: false; reasons: string[] } {
  const text = `${input.subject}\n${input.bodyHtmlOrText}`.toLowerCase();
  const reasons: string[] = [];

  if (
    /\b(act now|urgent(?:ly)?|immediate(?:ly)?|last chance|account will be (?:suspended|closed)|unless you (?:renew|pay|verify))\b/i.test(
      `${input.subject}\n${input.bodyHtmlOrText}`,
    )
  ) {
    reasons.push("Urgency/pressure language detected in sanitized output.");
  }

  const hasNameTag = (input.mergeTags ?? []).some((t) =>
    /^(name|first_name|full_name|recipient_name)$/i.test(t),
  );
  if (
    hasNameTag &&
    /\bdear\s+(customer|user|client|member|sir\/?madam)\b/i.test(input.bodyHtmlOrText)
  ) {
    reasons.push('Generic greeting "Dear Customer" used while a recipient name merge tag is available.');
  }

  const support = input.canonical.support_contact.toLowerCase();
  const supportBits = support.split(/[·|,]/).map((s) => s.trim()).filter(Boolean);
  const hasSupport = supportBits.some((bit) => bit && text.includes(bit.toLowerCase()));
  if (!hasSupport) {
    reasons.push("Verified support contact from company profile is missing in the sanitized output.");
  }

  if (!input.canonical.company_name.trim()) {
    reasons.push("Company name is empty or unverifiable.");
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
