import "server-only";

import {
  canonicalFieldsPromptBlock,
  type CanonicalContentFields,
} from "@/lib/content-genuineness/canonical-fields";
import { rewriteIntroducesUngroundedClaims } from "@/lib/content-genuineness/grounding";
import type { GenuinenessFeedback } from "@/lib/content-genuineness/types";
import { generateGeminiJsonText, resolveGeminiApiKey } from "@/lib/gemini/client";
import { mergeTagsPromptSection } from "@/lib/content-spam-review/merge-tags-prompt";

export type GroundedRewriteResult =
  | {
      ok: true;
      suggestedSubject: string;
      suggestedHtml: string;
      suggestedAttachmentHtml: string | null;
      summary: string;
      canonicalFields: CanonicalContentFields;
    }
  | { ok: false; reason: string };

function parseJson(text: string): {
  summary?: string;
  suggestedSubject?: string;
  suggestedHtml?: string;
  suggestedAttachmentHtml?: string | null;
} | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(raw) as {
      summary?: string;
      suggestedSubject?: string;
      suggestedHtml?: string;
      suggestedAttachmentHtml?: string | null;
    };
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as {
          summary?: string;
          suggestedSubject?: string;
          suggestedHtml?: string;
          suggestedAttachmentHtml?: string | null;
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildPrompt(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  plainBody: string;
  attachmentHtml: string | null;
  attachmentText: string | null;
  feedback: GenuinenessFeedback[];
  mergeTags: string[];
  canonical: CanonicalContentFields;
  consistencyRetryNote?: string | null;
}): string {
  const feedbackList =
    input.feedback.map((f) => `- [${f.category}] ${f.message}`).join("\n") || "- none";
  const wantAttachment = Boolean(input.attachmentHtml?.trim() || input.attachmentText?.trim());

  return `You help writers pass email deliverability review. Rewrite subject${wantAttachment ? ", body, AND attachment HTML" : " and body"} using ONE shared set of dynamic fields.

${canonicalFieldsPromptBlock(input.canonical)}

CRITICAL GROUNDING RULES:
- Do NOT invent products, prices, offers, deadlines, prizes, credentials, or claims absent from the source text/attachment — except you MUST use CANONICAL_FIELDS values for IDs/dates/company/support.
- Do NOT invent a second invoice number, transaction ID, renewal date, amount, or company name. Every artifact must use the same CANONICAL_FIELDS values.
- Do NOT add marketing hype, urgency, or clickbait ("act now", "unless you renew", fake deadlines).
- Preserve {{{merge_tags}}} already in the draft exactly when they match CANONICAL_FIELDS; otherwise use the CANONICAL_FIELDS value/placeholder.
- Where natural, include available merge tags (greeting with name, referencing email, etc.).
- Never use "Dear Customer" / "Dear User" when recipient_name is a {{{name}}} (or similar) merge tag — use that tag.
- Include the exact support_contact from CANONICAL_FIELDS in the body (and attachment footer when rewriting attachment).
- Avoid vague unverifiable company names; use company_name from CANONICAL_FIELDS.
- If the body is empty/minimal but attachment text exists, draft a short genuine subject + body that accurately summarizes what the attachment contains using CANONICAL_FIELDS — still no invented commercial claims.
- Return HTML body with simple <p> tags only.
- Subject under 78 characters.
${wantAttachment ? "- suggestedAttachmentHtml must be valid standalone HTML for a PDF/image attachment and must contain the SAME invoice_number, transaction_id, renewal_date, amount, and company_name as the body." : "- Set suggestedAttachmentHtml to null."}

PHISHING INDICATORS TO AVOID:
- Mismatched IDs between body and attachment
- Generic greetings when recipient name is known
- Missing / placeholder support contact
- Urgency / pressure language
- Tracking IDs that differ from CANONICAL_FIELDS

${mergeTagsPromptSection(input.mergeTags)}

${input.consistencyRetryNote ? `PREVIOUS ATTEMPT FAILED CONSISTENCY CHECK — fix these issues:\n${input.consistencyRetryNote}\n` : ""}

Return ONLY valid JSON:
{"summary":"...","suggestedSubject":"...","suggestedHtml":"...","suggestedAttachmentHtml": ${wantAttachment ? '"<html>...</html>"' : "null"}}

Sender display name: ${input.senderName || "(not set)"}

Review feedback to address:
${feedbackList}

Current subject:
${input.subject}

Current HTML body:
${input.bodyHtml.slice(0, 10_000)}

Plain body:
${input.plainBody.slice(0, 4000)}

Current attachment HTML (may be empty):
${(input.attachmentHtml ?? "").slice(0, 8000) || "(none)"}

Attachment text excerpt (may be empty):
${(input.attachmentText ?? "").slice(0, 6000) || "(none)"}`;
}

/**
 * Grounded rewrite with a single shared CANONICAL_FIELDS object for subject, body,
 * and (when present) attachment HTML — prevents phishing-like ID mismatches.
 */
export async function suggestGroundedRewrite(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  plainBody: string;
  attachmentHtml?: string | null;
  attachmentText: string | null;
  feedback: GenuinenessFeedback[];
  mergeTags?: string[];
  canonical: CanonicalContentFields;
  consistencyRetryNote?: string | null;
}): Promise<GroundedRewriteResult> {
  if (!resolveGeminiApiKey()) {
    return { ok: false, reason: "GEMINI_API_KEY not configured." };
  }

  const mergeTags = input.mergeTags ?? [];
  const wantAttachment = Boolean(
    input.attachmentHtml?.trim() || input.attachmentText?.trim(),
  );

  const prompt = buildPrompt({
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    senderName: input.senderName,
    plainBody: input.plainBody,
    attachmentHtml: input.attachmentHtml ?? null,
    attachmentText: input.attachmentText,
    feedback: input.feedback,
    mergeTags,
    canonical: input.canonical,
    consistencyRetryNote: input.consistencyRetryNote ?? null,
  });

  const result = await generateGeminiJsonText(prompt);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const parsed = parseJson(result.text);
  if (!parsed?.suggestedSubject || !parsed?.suggestedHtml) {
    return { ok: false, reason: "Could not parse grounded rewrite." };
  }

  let suggestedAttachmentHtml: string | null = null;
  if (wantAttachment) {
    const raw = parsed.suggestedAttachmentHtml;
    if (typeof raw === "string" && raw.trim()) {
      suggestedAttachmentHtml = raw.trim();
    } else {
      return {
        ok: false,
        reason: "Grounded rewrite omitted attachment HTML while an attachment was present.",
      };
    }
  }

  return {
    ok: true,
    suggestedSubject: parsed.suggestedSubject.trim(),
    suggestedHtml: parsed.suggestedHtml.trim(),
    suggestedAttachmentHtml,
    summary: (parsed.summary ?? "Rewrote content while staying grounded in your draft.").trim(),
    canonicalFields: input.canonical,
  };
}

export function isGroundedRewriteConfigured(): boolean {
  return resolveGeminiApiKey() != null;
}

export { rewriteIntroducesUngroundedClaims } from "@/lib/content-genuineness/grounding";
