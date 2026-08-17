import "server-only";

import { APP_BRAND_NAME, APP_DOMAIN, APP_NOREPLY_EMAIL, APP_PUBLIC_URL, resolveCanonicalCompanyName } from "@/lib/brand";
import { generateGeminiJsonText, humanizeGeminiFailure } from "@/lib/gemini/client";
import {
  parsePhishingVerdictJson,
  type PhishingMismatch,
  type PhishingVerdictJson,
} from "@/lib/content-genuineness/phishing-verdict-parse";

export type { PhishingMismatch, PhishingVerdictJson };

export type PhishingValidationResult = {
  /** True when Gemini returned parseable JSON (not on API failure). */
  executed: boolean;
  status: "PASS" | "FAIL" | "ERROR";
  mismatches_found: PhishingMismatch[];
  flags: string[];
  reasoning: string;
  /** Raw model JSON text for audit logs. */
  rawResponse: string | null;
  model: string | null;
  error: string | null;
};

function buildPhishingPrompt(input: {
  subject: string;
  bodyPlain: string;
  attachmentPlain: string;
  senderName: string;
  hasAttachment: boolean;
}): string {
  const attachmentSection = input.hasAttachment
    ? input.attachmentPlain.trim() || "(attachment present but no extractable text)"
    : "(attachment intentionally omitted by sender)";
  const attachmentPolicy = input.hasAttachment
    ? `An attachment is included. Compare its facts and topic with the email body.`
    : `NO ATTACHMENT WILL BE SENT. This is an intentional, allowed body-only email.
- Do NOT flag "Missing attachment".
- Do NOT require an attachment or compare the body against one.
- Judge only the subject and body.`;
  const company = resolveCanonicalCompanyName(input.senderName);

  return `You are a phishing and scam-content detector reviewing an email BEFORE it is sent. You will be given a subject, body, and optionally an attachment.

ATTACHMENT POLICY:
${attachmentPolicy}

Return FAIL if ANY of the following are true:
- Any factual field (invoice number, transaction ID, reference number, date, amount, recipient name, company name) differs between the email body and the PDF attachment.
- The email uses a generic/impersonal greeting ("Dear Customer") while addressing what claims to be a specific individual's account or transaction.
- The company display name in the content is missing or uses a different letter-order than "${company}" (a Pro/Fire swap is a mismatch). A hostname like ${APP_DOMAIN} in a URL or email address is expected and is not a substitute for omitting the display name in prose.
- There is urgency/pressure language, vague or missing support contact details, or mismatched/placeholder transaction identifiers that appear auto-generated rather than pulled from a real record.
- Any monetary amount, plan name, or renewal date appears inconsistent across the subject, body, or attachment.
- The content overall resembles a known phishing/invoice-scam pattern (fake renewal notice, fake payment confirmation designed to induce a support callback).
- The attachment topic does not match the email body (e.g. a connectivity-test email with an invoice PDF).
- Financial fields (invoice number, transaction ID, amount, renewal date) appear in a non-billing email.

Do NOT fail because links or From addresses use ${APP_DOMAIN} — that is the verified hostname for ${APP_BRAND_NAME}.
Do NOT fail a genuine status/connectivity notice solely as a subject/body mismatch when both describe the same operational event.
Do NOT treat "Hello {{{name}}}" or another recipient-name merge tag as a generic greeting; it is personalized at send time.
Do NOT copy example phrases from this prompt (such as "act now") into flags unless those phrases actually appear in the subject/body/attachment.

Verified support contact for this platform: ${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}
Company display name on file: ${company}

Respond ONLY with valid JSON — no markdown, no prose before/after. Keep "reasoning" to ONE short sentence (max 80 characters, no newlines):
{
  "status": "PASS" | "FAIL",
  "mismatches_found": [ { "field": string, "body_value": string, "attachment_value": string } ],
  "flags": [ string ],
  "reasoning": string
}

--- SUBJECT ---
${input.subject.slice(0, 500)}

--- EMAIL BODY (plain text) ---
${input.bodyPlain.slice(0, 12_000)}

--- PDF ATTACHMENT (extracted plain text) ---
${attachmentSection.slice(0, 12_000)}`;
}

/**
 * Mandatory Gemini 2.5 Flash phishing / consistency validation.
 * Never defaults to PASS on error — returns status ERROR instead.
 */
async function callAndParsePhishingVerdict(
  prompt: string,
): Promise<
  | { ok: true; parsed: PhishingVerdictJson; raw: string; model: string }
  | { ok: false; reason: string; raw: string | null; model: string | null }
> {
  const gemini = await generateGeminiJsonText(prompt, { preferLite: true });
  if (!gemini.ok) {
    return { ok: false, reason: humanizeGeminiFailure(gemini.reason), raw: null, model: null };
  }

  console.info("[phishing-validator] raw Gemini response:", gemini.text.slice(0, 2000));
  const parsed = parsePhishingVerdictJson(gemini.text);
  if (!parsed) {
    console.error("[phishing-validator] unparseable response:", gemini.text.slice(0, 800));
    return {
      ok: false,
      reason: "Could not parse Gemini phishing verdict JSON.",
      raw: gemini.text,
      model: gemini.model,
    };
  }

  return { ok: true, parsed, raw: gemini.text, model: gemini.model };
}

export async function runGeminiPhishingValidation(input: {
  subject: string;
  bodyPlain: string;
  attachmentPlain: string;
  senderName: string;
  hasAttachment: boolean;
}): Promise<PhishingValidationResult> {
  const prompt = buildPhishingPrompt(input);
  let result = await callAndParsePhishingVerdict(prompt);

  if (!result.ok && result.raw) {
    const retryPrompt =
      prompt +
      "\n\nIMPORTANT: Your previous reply was truncated or invalid JSON. Reply again with ONLY compact JSON. reasoning MUST be under 80 characters.";
    result = await callAndParsePhishingVerdict(retryPrompt);
  }

  if (!result.ok) {
    const error = result.reason;
    console.error("[phishing-validator] Gemini call failed:", error);
    return {
      executed: false,
      status: "ERROR",
      mismatches_found: [],
      flags: [],
      reasoning: error.includes("quota")
        ? error
        : "Verification could not be completed — send is blocked until this is resolved.",
      rawResponse: result.raw,
      model: result.model,
      error,
    };
  }

  const parsed = result.parsed;

  const pass =
    parsed.status === "PASS" &&
    (!input.hasAttachment || parsed.mismatches_found.length === 0);

  return {
    executed: true,
    status: pass ? "PASS" : "FAIL",
    mismatches_found: parsed.mismatches_found,
    flags: parsed.flags,
    reasoning: parsed.reasoning,
    rawResponse: result.raw,
    model: result.model,
    error: null,
  };
}

export function phishingVerdictBlocksSend(verdict: PhishingValidationResult): boolean {
  if (!verdict.executed) return true;
  if (verdict.status !== "PASS") return true;
  if (verdict.mismatches_found.length > 0) return true;
  return false;
}
