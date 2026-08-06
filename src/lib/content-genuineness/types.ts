/**
 * INTERNAL (admin/dev note — not user-facing):
 *
 * This system is a strong heuristic + AI-assisted content gate designed to catch
 * obviously non-genuine, templated, deceptive, or attachment-mismatched content
 * before send. It meaningfully reduces the most common causes of ESP suspensions
 * (attachment-only sends, templated filler, deceptive subject/body mismatches).
 * It is not a guarantee of zero spam complaints or zero suspensions — genuine list
 * quality, recipient consent, and sending volume/velocity remain the largest factors
 * in deliverability and are not fully solvable at the content-review layer. Client
 * trust tiers and sending limits remain the primary defense against list-quality and
 * volume-related risk; this gate is the primary defense against content-quality risk.
 */

export type GenuinenessCategory =
  | "subject_quality"
  | "body_quality"
  | "subject_body_mismatch"
  | "content_too_generic"
  | "attachment_content"
  | "attachment_mismatch"
  | "sender_trust"
  | "spam_pattern";

/** Client-facing feedback — no scores, weights, or rule IDs. */
export type GenuinenessFeedback = {
  category: GenuinenessCategory;
  message: string;
  /** Optional human-readable location hint (e.g. "Subject" or a sentence snippet). */
  locationHint?: string;
};

export type GenuinenessAttachmentInput = {
  filename: string;
  /** Raw bytes as base64 (binary PDF/docs) OR empty when htmlText is set. */
  contentBase64?: string;
  /** Plain text already extracted (HTML attachment → stripped text). */
  htmlText?: string;
};

export type GenuinenessReviewInput = {
  subject: string;
  bodyHtml: string;
  senderName: string;
  attachments?: GenuinenessAttachmentInput[];
  /** CSV / built-in merge tag keys available for personalization (e.g. name, email). */
  mergeTags?: string[];
};

export type GenuinenessInternalIssue = GenuinenessFeedback & {
  /** Internal-only code for audit/tests — never send to clients. */
  code: string;
  blocks: boolean;
};

export type GenuinenessReviewResult = {
  passed: boolean;
  feedback: GenuinenessFeedback[];
  issues: GenuinenessInternalIssue[];
  summary: string;
  /** Attachment text excerpts used (for AI grounding / audit). */
  attachmentTextExcerpt: string | null;
  suggestedSubject: string | null;
  suggestedHtml: string | null;
  aiUsed: boolean;
  aiNote: string | null;
};
