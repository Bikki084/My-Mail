import "server-only";

import { generateGeminiJsonText, resolveGeminiApiKey } from "@/lib/gemini/client";
import { rewriteIntroducesUngroundedClaims } from "@/lib/content-genuineness/grounding";
import type { GenuinenessFeedback } from "@/lib/content-genuineness/types";
import { mergeTagsPromptSection } from "@/lib/content-spam-review/merge-tags-prompt";

export type GroundedRewriteResult =
  | {
      ok: true;
      suggestedSubject: string;
      suggestedHtml: string;
      summary: string;
    }
  | { ok: false; reason: string };

function parseJson(text: string): {
  summary?: string;
  suggestedSubject?: string;
  suggestedHtml?: string;
} | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(raw) as { summary?: string; suggestedSubject?: string; suggestedHtml?: string };
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as {
          summary?: string;
          suggestedSubject?: string;
          suggestedHtml?: string;
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Grounded rewrite: rephrase/clarify only — must not invent offers or claims.
 * When body is thin and attachment text exists, draft from attachment facts.
 */
export async function suggestGroundedRewrite(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  plainBody: string;
  attachmentText: string | null;
  feedback: GenuinenessFeedback[];
  mergeTags?: string[];
}): Promise<GroundedRewriteResult> {
  if (!resolveGeminiApiKey()) {
    return { ok: false, reason: "GEMINI_API_KEY not configured." };
  }

  const feedbackList =
    input.feedback.map((f) => `- [${f.category}] ${f.message}`).join("\n") || "- none";
  const mergeTags = input.mergeTags ?? [];

  const prompt = `You help writers pass email deliverability review. Rewrite ONLY based on facts present in the user's draft and/or attachment excerpt. Personalize with available recipient merge tags.

CRITICAL GROUNDING RULES:
- Do NOT invent products, prices, offers, deadlines, prizes, credentials, or claims absent from the source text/attachment.
- Do NOT add marketing hype, urgency, or clickbait.
- Preserve {{{merge_tags}}} already in the draft exactly.
- Where natural, include available merge tags (greeting with name, referencing email, etc.).
- If the body is empty/minimal but attachment text exists, draft a short genuine subject + body that accurately summarizes what the attachment contains (who/what/why) — still no invented claims — and personalize with merge tags when available.
- Return HTML body with simple <p> tags only.
- Subject under 78 characters.

${mergeTagsPromptSection(mergeTags)}

Return ONLY valid JSON:
{"summary":"...","suggestedSubject":"...","suggestedHtml":"..."}

Sender display name: ${input.senderName || "(not set)"}

Review feedback to address:
${feedbackList}

Current subject:
${input.subject}

Current HTML body:
${input.bodyHtml.slice(0, 10_000)}

Plain body:
${input.plainBody.slice(0, 4000)}

Attachment excerpt (may be empty):
${(input.attachmentText ?? "").slice(0, 6000) || "(none)"}`;

  const result = await generateGeminiJsonText(prompt);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const parsed = parseJson(result.text);
  if (!parsed?.suggestedSubject || !parsed?.suggestedHtml) {
    return { ok: false, reason: "Could not parse grounded rewrite." };
  }

  return {
    ok: true,
    suggestedSubject: parsed.suggestedSubject.trim(),
    suggestedHtml: parsed.suggestedHtml.trim(),
    summary: (parsed.summary ?? "Rewrote content while staying grounded in your draft.").trim(),
  };
}

export function isGroundedRewriteConfigured(): boolean {
  return resolveGeminiApiKey() != null;
}

export { rewriteIntroducesUngroundedClaims } from "@/lib/content-genuineness/grounding";
