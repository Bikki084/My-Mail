import "server-only";

import { APP_NOREPLY_EMAIL, APP_PUBLIC_URL } from "@/lib/brand";
import { generateGeminiJsonText } from "@/lib/gemini/client";

export type PhishingMismatch = {
  field: string;
  body_value: string;
  attachment_value: string;
};

export type PhishingVerdictJson = {
  status: "PASS" | "FAIL";
  mismatches_found: PhishingMismatch[];
  flags: string[];
  reasoning: string;
};

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

export function parsePhishingVerdictJson(text: string): PhishingVerdictJson | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]!.trim() : trimmed;
  try {
    const parsed = JSON.parse(raw) as PhishingVerdictJson;
    if (parsed.status !== "PASS" && parsed.status !== "FAIL") return null;
    return {
      status: parsed.status,
      mismatches_found: Array.isArray(parsed.mismatches_found) ? parsed.mismatches_found : [],
      flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return parsePhishingVerdictJson(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildPhishingPrompt(input: {
  subject: string;
  bodyPlain: string;
  attachmentPlain: string;
  senderName: string;
  hasAttachment: boolean;
}): string {
  const attachmentSection = input.hasAttachment
    ? input.attachmentPlain.trim() || "(attachment present but no extractable text)"
    : "(no attachment provided)";

  return `You are a phishing and scam-content detector reviewing an email BEFORE it is sent. You will be given: (1) subject line, (2) email body, (3) extracted text from a PDF attachment. Analyze all three together as a single unit — do not evaluate them in isolation.

Return FAIL if ANY of the following are true:
- Any factual field (invoice number, transaction ID, reference number, date, amount, recipient name, company name) differs between the email body and the PDF attachment.
- The email uses a generic/impersonal greeting ("Dear Customer") while addressing what claims to be a specific individual's account or transaction.
- The sender company/brand name cannot be matched to a real, verified entity in our system records (flag as suspicious rather than assume legitimacy).
- There is urgency/pressure language, vague or missing support contact details, or mismatched/placeholder transaction identifiers that appear auto-generated rather than pulled from a real record.
- Any monetary amount, plan name, or renewal date appears inconsistent across the subject, body, or attachment.
- The content overall resembles a known phishing/invoice-scam pattern (fake renewal notice, fake payment confirmation designed to induce a support callback).

Verified support contact for this platform: ${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}
Sender display name on file: ${input.senderName || "(not set)"}

Respond ONLY in this JSON structure, nothing else:
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
export async function runGeminiPhishingValidation(input: {
  subject: string;
  bodyPlain: string;
  attachmentPlain: string;
  senderName: string;
  hasAttachment: boolean;
}): Promise<PhishingValidationResult> {
  const prompt = buildPhishingPrompt(input);
  const gemini = await generateGeminiJsonText(prompt);

  if (!gemini.ok) {
    console.error("[phishing-validator] Gemini call failed:", gemini.reason);
    return {
      executed: false,
      status: "ERROR",
      mismatches_found: [],
      flags: [],
      reasoning: "Verification could not be completed — send is blocked until this is resolved.",
      rawResponse: null,
      model: null,
      error: gemini.reason,
    };
  }

  console.info("[phishing-validator] raw Gemini response:", gemini.text.slice(0, 2000));

  const parsed = parsePhishingVerdictJson(gemini.text);
  if (!parsed) {
    console.error("[phishing-validator] unparseable response:", gemini.text.slice(0, 500));
    return {
      executed: false,
      status: "ERROR",
      mismatches_found: [],
      flags: ["Unparseable model response"],
      reasoning: "Verification could not be completed — send is blocked until this is resolved.",
      rawResponse: gemini.text,
      model: gemini.model,
      error: "Could not parse Gemini phishing verdict JSON.",
    };
  }

  const pass =
    parsed.status === "PASS" &&
    (!input.hasAttachment || parsed.mismatches_found.length === 0);

  return {
    executed: true,
    status: pass ? "PASS" : "FAIL",
    mismatches_found: parsed.mismatches_found,
    flags: parsed.flags,
    reasoning: parsed.reasoning,
    rawResponse: gemini.text,
    model: gemini.model,
    error: null,
  };
}

export function phishingVerdictBlocksSend(verdict: PhishingValidationResult): boolean {
  if (!verdict.executed) return true;
  if (verdict.status !== "PASS") return true;
  if (verdict.mismatches_found.length > 0) return true;
  return false;
}
