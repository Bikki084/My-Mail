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

export { runGenuinenessReview } from "@/lib/content-genuineness/review";
export {
  messageContentFingerprint,
  attachmentListFingerprint,
  issueGenuinenessPassToken,
  verifyGenuinenessPassToken,
} from "@/lib/content-genuineness/pass-token";
export type {
  GenuinenessReviewResult,
  GenuinenessFeedback,
  GenuinenessCategory,
  GenuinenessAttachmentInput,
} from "@/lib/content-genuineness/types";
export type { CanonicalContentFields } from "@/lib/content-genuineness/canonical-fields";
export {
  assertCrossArtifactConsistency,
  assertPhishingIndicatorSanity,
} from "@/lib/content-genuineness/consistency";
export { buildCanonicalContentFields } from "@/lib/content-genuineness/canonical-fields";
