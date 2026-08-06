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

/** Internal result — includes score for logging; never expose score to clients. */
export type ContentReviewInternalResult = {
  riskScore: number;
  riskLevel: ContentRiskLevel;
  issues: HeuristicIssue[];
  summary: string;
  suggestedSubject: string | null;
  suggestedHtml: string | null;
  aiUsed: boolean;
  aiNote: string | null;
};

/** Client-facing API — advisory only, no numeric score. */
export type ContentReviewPublicResult = {
  riskLevel: ContentRiskLevel;
  issues: Array<{ code: string; message: string }>;
  summary: string;
  suggestedSubject: string | null;
  suggestedHtml: string | null;
  aiUsed: boolean;
  aiNote: string | null;
  rescoringRemaining?: number;
};

export function toPublicContentReviewResult(
  internal: ContentReviewInternalResult,
  opts?: { rescoringRemaining?: number },
): ContentReviewPublicResult {
  return {
    riskLevel: internal.riskLevel,
    issues: internal.issues.map(({ code, message }) => ({ code, message })),
    summary: internal.summary,
    suggestedSubject: internal.suggestedSubject,
    suggestedHtml: internal.suggestedHtml,
    aiUsed: internal.aiUsed,
    aiNote: internal.aiNote,
    rescoringRemaining: opts?.rescoringRemaining,
  };
}

export async function reviewCampaignContent(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  useAi?: boolean;
  mergeTags?: string[];
}): Promise<ContentReviewInternalResult> {
  const subject = input.subject.trim();
  const bodyHtml = input.bodyHtml.trim();
  const senderName = input.senderName.trim();
  const plainBody = htmlToPlainText(bodyHtml);
  const mergeTags = input.mergeTags ?? [];

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
      mergeTags,
    });
    if (gemini.ok) {
      aiUsed = true;
      const rescore = analyzeContentHeuristics({
        subject: gemini.suggestedSubject,
        bodyHtml: gemini.suggestedHtml,
        senderName,
      });
      suggestedSubject = gemini.suggestedSubject;
      suggestedHtml = gemini.suggestedHtml;
      summary = gemini.summary;
      if (rescore.level === "high" && heuristics.level !== "high") {
        aiNote =
          "AI rewrite still shows high spam risk — edit further before sending at scale.";
      } else if (rescore.score < heuristics.score) {
        summary = `${gemini.summary} Risk reduced after rewrite.`;
      }
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
      mergeTags,
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
