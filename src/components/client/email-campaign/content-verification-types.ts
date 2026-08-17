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

/** Subject + body + sender — edits here always require re-verification. */
export function composeBodyKey(subject: string, html: string, sender: string): string {
  return `${subject.trim()}|${html.trim()}|${sender.trim()}`;
}

/** Legacy full compose key (includes attachment HTML). */
export function composeContentKey(
  subject: string,
  html: string,
  sender: string,
  attachmentHtml: string,
): string {
  return `${composeBodyKey(subject, html, sender)}|${attachmentHtml.trim()}`;
}

export type VerificationStatus = "unverified" | "passed" | "failed";

export type ContentVerificationCache = {
  contentFingerprint: string;
  /** @deprecated use bodyComposeKey — kept for persisted localStorage rows */
  composeKey: string;
  bodyComposeKey: string;
  /** Attachment HTML at verify time (empty when verified without attachment). */
  verifiedAttachmentHtml: string;
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

/**
 * Verification stays valid when body is unchanged and attachment is unchanged OR cleared.
 * Any body edit or attachment content edit requires re-verify.
 */
export function verificationStillValid(
  cache: ContentVerificationCache,
  subject: string,
  html: string,
  sender: string,
  attachmentHtml: string,
): boolean {
  const bodyKey = composeBodyKey(subject, html, sender);
  const cachedBodyKey =
    cache.bodyComposeKey ||
    (cache.composeKey.includes("|")
      ? cache.composeKey.split("|").slice(0, 3).join("|")
      : cache.composeKey);
  if (bodyKey !== cachedBodyKey) return false;

  const currentAttachment = attachmentHtml.trim();
  const verifiedAttachment = (cache.verifiedAttachmentHtml ?? "").trim();
  if (currentAttachment === verifiedAttachment) return true;
  // Cleared attachment after verify-with-attachment — still valid.
  if (verifiedAttachment !== "" && currentAttachment === "") return true;
  return false;
}

export function reviewToVerificationCache(
  review: ContentReviewResult,
  bodyComposeKey: string,
  verifiedAttachmentHtml: string,
): ContentVerificationCache {
  return {
    contentFingerprint: review.contentFingerprint ?? "",
    composeKey: bodyComposeKey,
    bodyComposeKey,
    verifiedAttachmentHtml: verifiedAttachmentHtml.trim(),
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
