import "server-only";

import { APP_NOREPLY_EMAIL, APP_PUBLIC_URL, resolveCanonicalCompanyName } from "@/lib/brand";
import { generateGeminiJsonText } from "@/lib/gemini/client";

export const CONTENT_TYPES = [
  "connectivity_test",
  "invoice",
  "renewal_notice",
  "welcome_email",
  "password_reset",
  "generic_notification",
] as const;

export type CampaignContentType = (typeof CONTENT_TYPES)[number];

const FINANCIAL_TYPES = new Set<CampaignContentType>(["invoice", "renewal_notice"]);

export function contentTypeAllowsFinancialFields(type: CampaignContentType): boolean {
  return FINANCIAL_TYPES.has(type);
}

export const FINANCIAL_FIELD_PATTERN =
  /\b(invoice|inv-\d|txn-?|transaction\s*id|amount due|renewal date|subscription invoice|billing statement)\b/i;

export function textHasFinancialFields(text: string): boolean {
  return FINANCIAL_FIELD_PATTERN.test(text);
}

/** Shared anti-phishing constraints — same bar as the pre-send verifier. */
export const SHARED_PHISHING_CONSTRAINTS = `ANTI-PHISHING / ANTI-SPAM CONSTRAINTS (generation MUST satisfy these — the same rules the verifier uses):
- Subject, body, and attachment are one unit. Facts in one must match the others.
- Do not use generic greetings ("Dear Customer", "Dear User") when {{{name}}} is available — greet with {{{name}}}.
- No urgency/pressure language ("act now", "immediately", "account will be suspended", "limited time", "urgent", "final notice", "last chance").
- No spam bait: "click here", "click below", winner, prize, lottery, casino, crypto/bitcoin pitch, wire transfer, "verify your account", "claim your", "make money", "work from home".
- Include the real support contact exactly: ${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}
- Use company_name from the canonical object verbatim in subject, body, and attachment (exact capitalization). Do not rearrange letters.
- Subject and body must be the same topic — reuse at least some of the same content words.
- Attachment content must be the same topic as the body (not an unrelated invoice, PDF bait, or placeholder).
- Do not invent mismatched invoice numbers, transaction IDs, amounts, or dates.
- Do not produce a fake renewal notice / fake payment confirmation designed to induce a support callback.
- Write a genuine first-party notice. Do not write promotional blast copy or phishing lures.
- No "please see the attached" filler without explaining what the document is.`;

function heuristicClassify(brief: string): CampaignContentType {
  const t = brief.toLowerCase();
  if (/\b(connectiv|smtp|ping|network status|mail test|test (the )?connect|connectivity test)\b/.test(t)) {
    return "connectivity_test";
  }
  if (/\b(password|reset|otp|one[- ]time code|login link)\b/.test(t)) {
    return "password_reset";
  }
  if (/\b(welcome|onboard|getting started)\b/.test(t)) {
    return "welcome_email";
  }
  if (/\b(invoice|billing|payment|amount due|receipt)\b/.test(t)) {
    return "invoice";
  }
  if (/\b(renewal|renew|subscription|monthly plan)\b/.test(t)) {
    return "renewal_notice";
  }
  return "generic_notification";
}

function parseType(text: string): CampaignContentType | null {
  try {
    const obj = JSON.parse(text) as { content_type?: string };
    const t = String(obj.content_type ?? "").trim();
    if ((CONTENT_TYPES as readonly string[]).includes(t)) return t as CampaignContentType;
  } catch {
    const m = text.match(/"content_type"\s*:\s*"([a-z_]+)"/i);
    if (m && (CONTENT_TYPES as readonly string[]).includes(m[1]!)) {
      return m[1] as CampaignContentType;
    }
  }
  return null;
}

/**
 * Classify the user brief. Heuristic first (never defaults to invoice).
 * Gemini may refine, but cannot override a non-financial heuristic to invoice
 * unless the brief itself contains billing language.
 */
export async function classifyContentType(brief: string): Promise<CampaignContentType> {
  const heuristic = heuristicClassify(brief);
  const prompt = `Classify this email request into ONE content_type.
Allowed values: ${CONTENT_TYPES.join(", ")}
Rules:
- Use invoice or renewal_notice ONLY if the user asked for billing, payment, invoice, receipt, or subscription renewal.
- Connectivity / SMTP / "test mail" / "phishing-free simple mail for testing" → connectivity_test
- Welcome / onboarding → welcome_email
- Password / reset / OTP → password_reset
- Anything else non-financial → generic_notification
Return JSON only: {"content_type":"..."}

User brief:
${brief.slice(0, 2000)}`;

  const gemini = await generateGeminiJsonText(prompt, { preferLite: true });
  if (!gemini.ok) return heuristic;
  const classified = parseType(gemini.text);
  if (!classified) return heuristic;
  if (FINANCIAL_TYPES.has(classified) && !FINANCIAL_TYPES.has(heuristic) && !textHasFinancialFields(brief)) {
    return heuristic;
  }
  return classified;
}

export function fieldSetForContentType(type: CampaignContentType): string[] {
  switch (type) {
    case "invoice":
    case "renewal_notice":
      return [
        "invoice_number",
        "transaction_id",
        "renewal_date",
        "amount",
        "plan_name",
        "company_name",
        "support_contact",
        "recipient_name",
      ];
    case "connectivity_test":
      return ["test_id", "timestamp", "status", "company_name", "support_contact", "recipient_name"];
    case "password_reset":
      return ["action", "company_name", "support_contact", "recipient_name"];
    case "welcome_email":
      return ["company_name", "support_contact", "recipient_name"];
    default:
      return ["topic", "company_name", "support_contact", "recipient_name"];
  }
}

export function seedCanonicalForType(input: {
  type: CampaignContentType;
  brief: string;
  senderName: string;
}): Record<string, string> {
  const company = resolveCanonicalCompanyName(input.senderName);
  const support = `${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}`;
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const idTail = Math.abs(hashBrief(input.brief)).toString(36).slice(0, 6).toUpperCase();

  switch (input.type) {
    case "connectivity_test":
      return {
        test_id: `CONN-${idTail}`,
        timestamp: stamp,
        status: "OK",
        company_name: company,
        support_contact: support,
        recipient_name: "{{{name}}}",
      };
    case "password_reset":
      return {
        action: "password reset",
        company_name: company,
        support_contact: support,
        recipient_name: "{{{name}}}",
      };
    case "welcome_email":
      return {
        company_name: company,
        support_contact: support,
        recipient_name: "{{{name}}}",
      };
    case "generic_notification":
      return {
        topic: input.brief.slice(0, 80).trim() || "account notice",
        company_name: company,
        support_contact: support,
        recipient_name: "{{{name}}}",
      };
    default:
      return {
        company_name: company,
        support_contact: support,
        recipient_name: "{{{name}}}",
      };
  }
}

function hashBrief(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
