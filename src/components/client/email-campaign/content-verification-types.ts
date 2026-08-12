/** Shared content verification types for composer UI + campaign context. */

export type PhishingVerdictView = {
  executed: boolean;
  status: "PASS" | "FAIL" | "ERROR";
  mismatches_found: { field: string; body_value: string; attachment_value: string }[];
  flags: string[];
  reasoning: string;
  rawResponse: string | null;
  model: string | null;
  error: string | null;
};

export type ContentReviewResult = {
  passed: boolean;
  passToken: string | null;
  contentFingerprint?: string;
  riskLevel: "low" | "medium" | "high";
  feedback?: {
    category: string;
    message: string;
    locationHint?: string;
  }[];
  issues: { code: string; message: string; locationHint?: string }[];
  summary: string;
  suggestedSubject: string | null;
  suggestedHtml: string | null;
  suggestedAttachmentHtml?: string | null;
  canonicalFields?: Record<string, string> | null;
  aiUsed: boolean;
  aiNote: string | null;
  phishingVerdict?: PhishingVerdictView;
  generatedContent?: {
    subject: string;
    bodyHtml: string;
    attachmentHtml: string;
  } | null;
  rescoringRemaining?: number;
  gateRequired?: boolean;
};

/** Client-side compose key for instant invalidation when user edits. */
export function composeContentKey(
  subject: string,
  html: string,
  sender: string,
  attachmentHtml: string,
): string {
  return `${subject.trim()}|${html.trim()}|${sender.trim()}|${attachmentHtml.trim()}`;
}

export type VerificationStatus = "unverified" | "passed" | "failed";

export type ContentVerificationCache = {
  contentFingerprint: string;
  composeKey: string;
  status: VerificationStatus;
  passed: boolean;
  passToken: string | null;
  summary: string;
  phishingVerdict?: PhishingVerdictView | null;
  feedback?: ContentReviewResult["feedback"];
  issues?: ContentReviewResult["issues"];
  suggestedSubject?: string | null;
  suggestedHtml?: string | null;
  suggestedAttachmentHtml?: string | null;
  canonicalFields?: Record<string, string> | null;
  aiUsed?: boolean;
  aiNote?: string | null;
  verifiedAt?: string;
};

export function reviewToVerificationCache(
  review: ContentReviewResult,
  composeKey: string,
): ContentVerificationCache {
  return {
    contentFingerprint: review.contentFingerprint ?? "",
    composeKey,
    status: review.passed ? "passed" : "failed",
    passed: review.passed,
    passToken: review.passToken,
    summary: review.summary,
    phishingVerdict: review.phishingVerdict ?? null,
    feedback: review.feedback,
    issues: review.issues,
    suggestedSubject: review.suggestedSubject,
    suggestedHtml: review.suggestedHtml,
    suggestedAttachmentHtml: review.suggestedAttachmentHtml ?? null,
    canonicalFields: review.canonicalFields ?? null,
    aiUsed: review.aiUsed,
    aiNote: review.aiNote,
    verifiedAt: new Date().toISOString(),
  };
}

export function cacheToContentReview(cache: ContentVerificationCache): ContentReviewResult {
  return {
    passed: cache.passed,
    passToken: cache.passToken,
    contentFingerprint: cache.contentFingerprint,
    riskLevel: "low",
    feedback: cache.feedback,
    issues: cache.issues ?? [],
    summary: cache.summary,
    suggestedSubject: cache.suggestedSubject ?? null,
    suggestedHtml: cache.suggestedHtml ?? null,
    suggestedAttachmentHtml: cache.suggestedAttachmentHtml ?? null,
    canonicalFields: cache.canonicalFields ?? null,
    aiUsed: cache.aiUsed ?? false,
    aiNote: cache.aiNote ?? null,
    phishingVerdict: cache.phishingVerdict ?? undefined,
  };
}
