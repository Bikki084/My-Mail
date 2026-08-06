import "server-only";

import { rewriteIntroducesUngroundedClaims } from "@/lib/content-genuineness/grounding";
import type { GenuinenessFeedback } from "@/lib/content-genuineness/types";

export type GroundedRewriteResult =
  | {
      ok: true;
      suggestedSubject: string;
      suggestedHtml: string;
      summary: string;
    }
  | { ok: false; reason: string };

function geminiApiKey(): string | null {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

function geminiModel(): string {
  return (process.env.GEMINI_CONTENT_REVIEW_MODEL ?? "gemini-2.0-flash").trim();
}

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
}): Promise<GroundedRewriteResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    return { ok: false, reason: "GEMINI_API_KEY not configured." };
  }

  const feedbackList =
    input.feedback.map((f) => `- [${f.category}] ${f.message}`).join("\n") || "- none";

  const prompt = `You help writers pass email deliverability review. Rewrite ONLY based on facts present in the user's draft and/or attachment excerpt.

CRITICAL GROUNDING RULES:
- Do NOT invent products, prices, offers, deadlines, prizes, credentials, or claims absent from the source text/attachment.
- Do NOT add marketing hype, urgency, or clickbait.
- Rephrase for clarity and professionalism; preserve {{{merge_tags}}} exactly.
- If the body is empty/minimal but attachment text exists, draft a short genuine subject + body that accurately summarizes what the attachment contains (who/what/why) — still no invented claims.
- Return HTML body with simple <p> tags only.
- Subject under 78 characters.

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

  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, reason: `Gemini API error ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = parseJson(text);
    if (!parsed?.suggestedSubject || !parsed?.suggestedHtml) {
      return { ok: false, reason: "Could not parse grounded rewrite." };
    }

    return {
      ok: true,
      suggestedSubject: parsed.suggestedSubject.trim(),
      suggestedHtml: parsed.suggestedHtml.trim(),
      summary: (parsed.summary ?? "Rewrote content while staying grounded in your draft.").trim(),
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export function isGroundedRewriteConfigured(): boolean {
  return geminiApiKey() != null;
}

export { rewriteIntroducesUngroundedClaims } from "@/lib/content-genuineness/grounding";
