import { htmlToPlainText } from "@/lib/html-email";
import {
  analyzeContentHeuristics,
  heuristicSuggestions,
  type ContentRiskLevel,
  type HeuristicIssue,
} from "@/lib/content-spam-review/heuristics";
import {
  isGeminiContentReviewConfigured,
  suggestSpamFreeContentWithGemini,
} from "@/lib/content-spam-review/gemini-suggest";

export type ContentReviewResult = {
  riskScore: number;
  riskLevel: ContentRiskLevel;
  issues: HeuristicIssue[];
  summary: string;
  suggestedSubject: string | null;
  suggestedHtml: string | null;
  aiUsed: boolean;
  aiNote: string | null;
};

export async function reviewCampaignContent(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  useAi?: boolean;
}): Promise<ContentReviewResult> {
  const subject = input.subject.trim();
  const bodyHtml = input.bodyHtml.trim();
  const senderName = input.senderName.trim();
  const plainBody = htmlToPlainText(bodyHtml);

  const heuristics = analyzeContentHeuristics({ subject, bodyHtml, senderName });
  let suggestedSubject: string | null = null;
  let suggestedHtml: string | null = null;
  let summary = "";
  let aiUsed = false;
  let aiNote: string | null = null;

  const wantAi = input.useAi !== false && heuristics.level !== "low";

  if (wantAi && isGeminiContentReviewConfigured()) {
    const gemini = await suggestSpamFreeContentWithGemini({
      subject,
      bodyHtml,
      senderName,
      plainBody,
      heuristicScore: heuristics.score,
      issues: heuristics.issues,
    });
    if (gemini.ok) {
      aiUsed = true;
      suggestedSubject = gemini.suggestedSubject;
      suggestedHtml = gemini.suggestedHtml;
      summary = gemini.summary;
    } else {
      aiNote = gemini.reason;
    }
  } else if (wantAi && !isGeminiContentReviewConfigured()) {
    aiNote =
      "Add GEMINI_API_KEY (free at Google AI Studio) on the server for AI-powered rewrites.";
  }

  if (!suggestedSubject && !suggestedHtml) {
    const rule = heuristicSuggestions({
      subject,
      bodyHtml,
      issues: heuristics.issues,
    });
    suggestedSubject = rule.subject ?? null;
    suggestedHtml = rule.bodyHtml ?? null;
    if (!summary) {
      summary =
        heuristics.level === "low"
          ? "Content looks reasonable. No major spam triggers detected."
          : "Rule-based suggestions applied — review before sending.";
    }
  }

  if (!summary) {
    summary =
      heuristics.level === "high"
        ? "High spam risk — strongly consider the suggested rewrite before sending."
        : heuristics.level === "medium"
          ? "Some spam signals detected — suggestions may improve inbox placement."
          : "Content looks reasonable.";
  }

  return {
    riskScore: heuristics.score,
    riskLevel: heuristics.level,
    issues: heuristics.issues,
    summary,
    suggestedSubject,
    suggestedHtml,
    aiUsed,
    aiNote,
  };
}

export { analyzeContentHeuristics, isGeminiContentReviewConfigured };
