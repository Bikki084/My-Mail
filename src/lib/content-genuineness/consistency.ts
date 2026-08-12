/**
 * Cross-check subject / body / attachment for phishing-like field mismatches.
 */

import {
  TRACKED_KEYS,
  type CanonicalContentFields,
  type CanonicalFieldKey,
  extractDynamicFieldCandidates,
} from "@/lib/content-genuineness/canonical-fields";

export type ConsistencyMismatch = {
  field: CanonicalFieldKey;
  expected: string;
  subject?: string | null;
  body?: string | null;
  attachment?: string | null;
  detail: string;
};

export type ConsistencyCheckResult =
  | { ok: true }
  | { ok: false; mismatches: ConsistencyMismatch[] };

function normalizeComparable(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fieldMentioned(
  candidates: Partial<Record<CanonicalFieldKey, string[]>>,
  field: CanonicalFieldKey,
): string | null {
  const list = candidates[field];
  return list?.[0] ?? null;
}

function valuesConflict(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  // Merge-tag placeholders must match exactly (case-insensitive tag name).
  if (a.includes("{{{") || b.includes("{{{")) {
    return normalizeComparable(a) !== normalizeComparable(b);
  }
  return normalizeComparable(a) !== normalizeComparable(b);
}

/**
 * Assert tracked dynamic fields are identical across artifacts and match canonical.
 * Empty optional fields (amount/plan) are skipped when absent from an artifact.
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

  const mismatches: ConsistencyMismatch[] = [];

  for (const field of TRACKED_KEYS) {
    const expected = input.canonical[field]?.trim() ?? "";
    if (!expected) continue;

    const subjectVal = fieldMentioned(subjectC, field);
    const bodyVal = fieldMentioned(bodyC, field);
    const attVal = attText ? fieldMentioned(attC, field) : null;

    // If the field appears in multiple artifacts, they must agree with each other.
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
        if (v && valuesConflict(first, v)) {
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

    // Any mentioned value must match canonical when canonical is a concrete literal
    // or a merge-tag placeholder.
    for (const [where, v] of present) {
      if (!v) continue;
      if (valuesConflict(expected, v)) {
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

    // Required identity fields must appear in body when rewritten; invoice+txn also in
    // attachment when an attachment was rewritten.
    if (
      (field === "invoice_number" || field === "transaction_id" || field === "company_name") &&
      !bodyVal &&
      expected &&
      !expected.includes("{{{")
    ) {
      // Soft: only hard-fail when attachment also has a conflicting different ID already caught,
      // or when attachment mentions a different value. Missing from body alone is flagged if
      // attachment has the field (rewrite should have mirrored it).
      if (attVal) {
        mismatches.push({
          field,
          expected,
          subject: subjectVal,
          body: bodyVal,
          attachment: attVal,
          detail: `${field} present in attachment but missing from body.`,
        });
      }
    }
  }

  // Deduplicate by field+detail
  const seen = new Set<string>();
  const unique = mismatches.filter((m) => {
    const k = `${m.field}:${m.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return unique.length === 0 ? { ok: true } : { ok: false, mismatches: unique };
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
