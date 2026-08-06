import "server-only";

import { htmlToPlainText } from "@/lib/html-email";
import {
  checkBodyGenuineness,
  checkHeuristicHardBlocks,
  checkSenderTrust,
  checkSubjectBodyAlignment,
  checkSubjectGenuineness,
} from "@/lib/content-genuineness/checks";
import {
  checkAttachmentContent,
  checkBodyAttachmentRelevance,
  collectAttachmentTexts,
} from "@/lib/content-genuineness/attachment";
import {
  isGroundedRewriteConfigured,
  suggestGroundedRewrite,
} from "@/lib/content-genuineness/gemini-grounded";
import { rewriteIntroducesUngroundedClaims } from "@/lib/content-genuineness/grounding";
import type {
  GenuinenessFeedback,
  GenuinenessInternalIssue,
  GenuinenessReviewInput,
  GenuinenessReviewResult,
} from "@/lib/content-genuineness/types";

function toPublicFeedback(issues: GenuinenessInternalIssue[]): GenuinenessFeedback[] {
  const seen = new Set<string>();
  const out: GenuinenessFeedback[] = [];
  for (const i of issues) {
    const key = `${i.category}:${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      category: i.category,
      message: i.message,
      locationHint: i.locationHint,
    });
  }
  return out;
}

/**
 * Full pre-send genuineness review. Hard-fail on any blocking issue.
 * AI suggestions are optional assists — never auto-approve.
 */
export async function runGenuinenessReview(
  input: GenuinenessReviewInput,
  opts?: { useAi?: boolean },
): Promise<GenuinenessReviewResult> {
  const subject = input.subject.trim();
  const bodyHtml = input.bodyHtml.trim();
  const senderName = input.senderName.trim();
  const plainBody = htmlToPlainText(bodyHtml).trim();

  const { combined: attachmentCombined, perFile } = await collectAttachmentTexts(
    input.attachments,
  );

  const issues: GenuinenessInternalIssue[] = [
    ...checkSubjectGenuineness(subject),
    ...checkBodyGenuineness(bodyHtml),
    ...checkSubjectBodyAlignment(subject, bodyHtml),
    ...checkSenderTrust(senderName),
    ...checkHeuristicHardBlocks({ subject, bodyHtml, senderName }),
    ...checkAttachmentContent(perFile),
    ...checkBodyAttachmentRelevance(plainBody, attachmentCombined),
  ];

  // Attachment present but body minimal → block (even if quality min words somehow bypassed)
  if (attachmentCombined && plainBody.split(/\s+/).filter(Boolean).length < 15) {
    issues.push({
      code: "thin_body_with_attachment",
      category: "body_quality",
      message:
        "Body is too thin relative to the attachment — write a genuine message that explains what the document is.",
      locationHint: "Body",
      blocks: true,
    });
  }

  const blocking = issues.filter((i) => i.blocks);
  const passed = blocking.length === 0;
  const feedback = toPublicFeedback(issues);

  let suggestedSubject: string | null = null;
  let suggestedHtml: string | null = null;
  let aiUsed = false;
  let aiNote: string | null = null;
  let summary = passed
    ? "Content passed genuineness review — Send is unlocked for this message version."
    : "Content did not pass review — fix the issues below or use AI-assisted rewrite, then re-check.";

  const wantAi = opts?.useAi !== false && (!passed || (attachmentCombined && !plainBody));
  if (wantAi && isGroundedRewriteConfigured()) {
    const gemini = await suggestGroundedRewrite({
      subject,
      bodyHtml,
      senderName,
      plainBody,
      attachmentText: attachmentCombined || null,
      feedback,
      mergeTags: input.mergeTags ?? [],
    });
    if (gemini.ok) {
      const sources = `${subject}\n${plainBody}\n${attachmentCombined}`;
      const rewritePlain = htmlToPlainText(gemini.suggestedHtml);
      if (rewriteIntroducesUngroundedClaims(rewritePlain, sources)) {
        aiNote =
          "AI rewrite looked like it added claims not present in your draft/attachment — suggestion withheld. Edit manually.";
      } else {
        aiUsed = true;
        suggestedSubject = gemini.suggestedSubject;
        suggestedHtml = gemini.suggestedHtml;
        summary = passed ? summary : gemini.summary;
      }
    } else {
      aiNote = gemini.reason;
    }
  } else if (wantAi && !isGroundedRewriteConfigured()) {
    aiNote = "Add GEMINI_API_KEY for AI-assisted grounded rewrites.";
  }

  return {
    passed,
    feedback,
    issues,
    summary,
    attachmentTextExcerpt: attachmentCombined
      ? attachmentCombined.slice(0, 2000)
      : null,
    suggestedSubject,
    suggestedHtml,
    aiUsed,
    aiNote,
  };
}
