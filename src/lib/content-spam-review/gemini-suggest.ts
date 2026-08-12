import "server-only";

import { generateGeminiJsonText, resolveGeminiApiKey } from "@/lib/gemini/client";
import type { HeuristicIssue } from "@/lib/content-spam-review/heuristics";
import { mergeTagsPromptSection } from "@/lib/content-spam-review/merge-tags-prompt";

export type GeminiSuggestionResult = {
  ok: true;
  suggestedSubject: string;
  suggestedHtml: string;
  summary: string;
} | {
  ok: false;
  reason: string;
};

type GeminiJson = {
  summary?: string;
  suggestedSubject?: string;
  suggestedHtml?: string;
};

function parseGeminiJson(text: string): GeminiJson | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(raw) as GeminiJson;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as GeminiJson;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Google Gemini (AI Studio) — rewrite subject/body to reduce spam signals.
 * https://aistudio.google.com/apikey
 */
export async function suggestSpamFreeContentWithGemini(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  plainBody: string;
  heuristicScore: number;
  issues: HeuristicIssue[];
  mergeTags?: string[];
}): Promise<GeminiSuggestionResult> {
  if (!resolveGeminiApiKey()) {
    return { ok: false, reason: "GEMINI_API_KEY not configured — using rule-based suggestions only." };
  }

  const issueList = input.issues.map((i) => `- ${i.message}`).join("\n") || "- none listed";
  const mergeTags = input.mergeTags ?? [];
  const prompt = `You are an email deliverability expert. Review this bulk/transactional email draft and rewrite it to reduce spam-filter risk while keeping the same intent. Personalize naturally with the available recipient merge tags.

Return ONLY valid JSON (no markdown outside the json block) with this shape:
{
  "summary": "one sentence on what was risky and what you fixed",
  "suggestedSubject": "rewritten subject line",
  "suggestedHtml": "rewritten HTML body as a single string with <p> tags"
}

Rules:
- Keep a professional, human tone — not salesy or urgent
- Remove spam trigger words (FREE, ACT NOW, excessive caps, fake urgency)
- Ensure the body has at least 2-3 short paragraphs of useful context (not attachment-only)
- Preserve any {{{merge_tag}}} placeholders already in the draft exactly
- Where natural, include available merge tags for personalization (greeting, mailbox confirmation, etc.)
- Do not add fake legal text or misleading claims
- Do not use Re:/Fwd: prefixes unless the original had them legitimately
- Avoid URL shorteners; use full https:// links if links are needed
- No hidden HTML (display:none, font-size:0)
- Subject under 78 characters if possible

${mergeTagsPromptSection(mergeTags)}

Sender name: ${input.senderName || "(not set)"}
Heuristic spam risk score (0-100): ${input.heuristicScore}
Issues detected:
${issueList}

Current subject: ${input.subject}

Current HTML body:
${input.bodyHtml.slice(0, 12_000)}

Plain text version:
${input.plainBody.slice(0, 4000)}`;

  const result = await generateGeminiJsonText(prompt);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const parsed = parseGeminiJson(result.text);
  if (!parsed?.suggestedSubject || !parsed?.suggestedHtml) {
    return { ok: false, reason: "Could not parse Gemini suggestions." };
  }

  return {
    ok: true,
    suggestedSubject: parsed.suggestedSubject.trim(),
    suggestedHtml: parsed.suggestedHtml.trim(),
    summary: (parsed.summary ?? "Content revised to reduce spam signals.").trim(),
  };
}

export function isGeminiContentReviewConfigured(): boolean {
  return resolveGeminiApiKey() != null;
}
