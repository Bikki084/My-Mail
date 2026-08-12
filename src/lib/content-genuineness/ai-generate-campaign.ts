import "server-only";

import { APP_NOREPLY_EMAIL, APP_PUBLIC_URL, APP_BRAND_NAME } from "@/lib/brand";
import { buildCanonicalContentFields } from "@/lib/content-genuineness/canonical-fields";
import { generateGeminiJsonText } from "@/lib/gemini/client";

export type AiGeneratedCampaign = {
  ok: true;
  subject: string;
  bodyHtml: string;
  attachmentHtml: string;
  canonicalFields: ReturnType<typeof buildCanonicalContentFields>;
} | { ok: false; reason: string };

function parseGenerated(text: string): {
  subject?: string;
  bodyHtml?: string;
  attachmentHtml?: string;
} | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(raw) as { subject?: string; bodyHtml?: string; attachmentHtml?: string };
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as {
          subject?: string;
          bodyHtml?: string;
          attachmentHtml?: string;
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** AI-Generate mode: one Gemini call produces subject + body + attachment from a brief. */
export async function generateCampaignFromBrief(input: {
  brief: string;
  senderName: string;
  mergeTags?: string[];
}): Promise<AiGeneratedCampaign> {
  const canonical = buildCanonicalContentFields({
    subject: input.brief,
    plainBody: input.brief,
    attachmentText: null,
    senderName: input.senderName,
    mergeTags: input.mergeTags ?? [],
  });

  const prompt = `Generate a professional email campaign (subject, HTML body, HTML attachment) from this user brief.
Use ONE shared set of facts — never invent different invoice/transaction/date values across artifacts.

CANONICAL_FIELDS (use these EXACT literal values in subject, body, AND attachment):
${JSON.stringify(canonical, null, 2)}

Rules:
- Return JSON only: {"subject":"...","bodyHtml":"<p>...</p>","attachmentHtml":"<html>...</html>"}
- Use simple <p> tags in bodyHtml; attachmentHtml should be a standalone invoice/document layout.
- Include support contact: ${APP_NOREPLY_EMAIL} · ${APP_PUBLIC_URL}
- Company: ${input.senderName || APP_BRAND_NAME}
- Personalize greeting with {{{name}}} if appropriate.
- No urgency/scam language.

User brief:
${input.brief.slice(0, 4000)}`;

  const result = await generateGeminiJsonText(prompt);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const parsed = parseGenerated(result.text);
  if (!parsed?.subject || !parsed.bodyHtml || !parsed.attachmentHtml) {
    return { ok: false, reason: "Could not parse AI-generated campaign." };
  }

  return {
    ok: true,
    subject: parsed.subject.trim(),
    bodyHtml: parsed.bodyHtml.trim(),
    attachmentHtml: parsed.attachmentHtml.trim(),
    canonicalFields: canonical,
  };
}
