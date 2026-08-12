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
  buildCanonicalContentFields,
  canonicalFieldsAuditId,
  type CanonicalContentFields,
} from "@/lib/content-genuineness/canonical-fields";
import {
  assertFinalPersistedConsistency,
  assertPhishingIndicatorSanity,
} from "@/lib/content-genuineness/consistency";
import { buildPreviewRecipientRow } from "@/lib/content-genuineness/preview-recipient";
import {
  isGroundedRewriteConfigured,
  suggestGroundedRewrite,
} from "@/lib/content-genuineness/gemini-grounded";
import {
  phishingVerdictBlocksSend,
  runGeminiPhishingValidation,
  type PhishingValidationResult,
} from "@/lib/content-genuineness/gemini-phishing-validator";
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

function attachmentHtmlFromInput(input: GenuinenessReviewInput): string | null {
  const html = input.attachments?.find((a) => a.htmlText?.trim())?.htmlText?.trim();
  return html || null;
}

function applyPhishingVerdictToIssues(
  issues: GenuinenessInternalIssue[],
  verdict: PhishingValidationResult,
): void {
  if (!verdict.executed) {
    issues.push({
      code: "gemini_verification_error",
      category: "attachment_mismatch",
      message:
        verdict.reasoning ||
        "Verification could not be completed — send is blocked until this is resolved.",
      locationHint: "Gemini validator",
      blocks: true,
    });
    if (verdict.error) {
      issues.push({
        code: "gemini_api_error",
        category: "attachment_mismatch",
        message: verdict.error,
        blocks: true,
      });
    }
    return;
  }

  if (phishingVerdictBlocksSend(verdict)) {
    for (const m of verdict.mismatches_found) {
      issues.push({
        code: "phishing_field_mismatch",
        category: "attachment_mismatch",
        message: `${m.field}: body "${m.body_value}" vs attachment "${m.attachment_value}"`,
        locationHint: "Body + attachment",
        blocks: true,
      });
    }
    for (const flag of verdict.flags) {
      issues.push({
        code: "phishing_flag",
        category: "spam_pattern",
        message: flag,
        blocks: true,
      });
    }
    if (verdict.mismatches_found.length === 0 && verdict.flags.length === 0) {
      issues.push({
        code: "phishing_verdict_fail",
        category: "attachment_mismatch",
        message: verdict.reasoning || "Content failed phishing verification.",
        blocks: true,
      });
    }
  }
}

async function runConsistentRewrite(args: {
  subject: string;
  bodyHtml: string;
  senderName: string;
  plainBody: string;
  attachmentCombined: string;
  attachmentHtml: string | null;
  feedback: GenuinenessFeedback[];
  mergeTags: string[];
  canonical: CanonicalContentFields;
}): Promise<{
  ok: true;
  suggestedSubject: string;
  suggestedHtml: string;
  suggestedAttachmentHtml: string | null;
  summary: string;
  canonicalFields: CanonicalContentFields;
} | {
  ok: false;
  reason: string;
  canonicalFields: CanonicalContentFields;
}> {
  let retryNote: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const gemini = await suggestGroundedRewrite({
      subject: args.subject,
      bodyHtml: args.bodyHtml,
      senderName: args.senderName,
      plainBody: args.plainBody,
      attachmentHtml: args.attachmentHtml,
      attachmentText: args.attachmentCombined || null,
      feedback: args.feedback,
      mergeTags: args.mergeTags,
      canonical: args.canonical,
      consistencyRetryNote: retryNote,
    });

    if (!gemini.ok) {
      return { ok: false, reason: gemini.reason, canonicalFields: args.canonical };
    }

    const sources = `${args.subject}\n${args.plainBody}\n${args.attachmentCombined}`;
    const rewritePlain = htmlToPlainText(gemini.suggestedHtml);
    if (rewriteIntroducesUngroundedClaims(rewritePlain, sources)) {
      return {
        ok: false,
        reason:
          "AI rewrite looked like it added claims not present in your draft/attachment — suggestion withheld. Edit manually.",
        canonicalFields: args.canonical,
      };
    }

    const previewRecipient = buildPreviewRecipientRow(null);
    const consistency = assertFinalPersistedConsistency({
      subject: gemini.suggestedSubject,
      bodyHtml: gemini.suggestedHtml,
      attachmentHtml: gemini.suggestedAttachmentHtml,
      senderName: args.senderName,
      previewRecipient,
    });

    const phishing = assertPhishingIndicatorSanity({
      canonical: args.canonical,
      subject: gemini.suggestedSubject,
      bodyHtmlOrText: `${gemini.suggestedHtml}\n${rewritePlain}`,
      mergeTags: args.mergeTags,
    });

    if (consistency.ok && phishing.ok) {
      console.info("[content-genuineness] apply-ready rewrite", {
        canonicalId: canonicalFieldsAuditId(args.canonical),
        subject: gemini.suggestedSubject,
      });
      return {
        ok: true,
        suggestedSubject: gemini.suggestedSubject,
        suggestedHtml: gemini.suggestedHtml,
        suggestedAttachmentHtml: gemini.suggestedAttachmentHtml,
        summary: gemini.summary,
        canonicalFields: args.canonical,
      };
    }

    const parts: string[] = [];
    if (!consistency.ok) {
      parts.push(...consistency.mismatches.map((m) => `- ${m.detail}`));
    }
    if (!phishing.ok) {
      parts.push(...phishing.reasons.map((r) => `- ${r}`));
    }
    retryNote = parts.join("\n");

    if (attempt === 1) {
      return {
        ok: false,
        reason: "Consistency check failed — subject/body/attachment dynamic fields did not match. Please retry.",
        canonicalFields: args.canonical,
      };
    }
  }

  return {
    ok: false,
    reason: "Consistency check failed — please retry.",
    canonicalFields: args.canonical,
  };
}

/**
 * Full pre-send genuineness review.
 * PASS requires a successful Gemini 2.5 Flash phishing verdict with status PASS
 * and empty mismatches_found — never a heuristic-only rubber stamp.
 */
export async function runGenuinenessReview(
  input: GenuinenessReviewInput,
  opts?: { useAi?: boolean },
): Promise<GenuinenessReviewResult> {
  const subject = input.subject.trim();
  const bodyHtml = input.bodyHtml.trim();
  const senderName = input.senderName.trim();
  const plainBody = htmlToPlainText(bodyHtml).trim();
  const mergeTags = input.mergeTags ?? [];
  const attachmentHtml = attachmentHtmlFromInput(input);
  const expectAttachment = input.expectAttachment === true;

  const { combined: attachmentCombined, perFile } = await collectAttachmentTexts(
    input.attachments,
  );

  const attachmentPlain =
    attachmentCombined.trim() ||
    (attachmentHtml ? htmlToPlainText(attachmentHtml).trim() : "");

  const issues: GenuinenessInternalIssue[] = [
    ...checkSubjectGenuineness(subject),
    ...checkBodyGenuineness(bodyHtml),
    ...checkSubjectBodyAlignment(subject, bodyHtml),
    ...checkSenderTrust(senderName),
    ...checkHeuristicHardBlocks({ subject, bodyHtml, senderName }),
    ...checkAttachmentContent(perFile),
    ...checkBodyAttachmentRelevance(plainBody, attachmentPlain),
  ];

  if (expectAttachment && !attachmentPlain) {
    issues.push({
      code: "attachment_missing_for_verify",
      category: "attachment_mismatch",
      message:
        "An attachment is configured but no attachment text was provided for verification — send is blocked.",
      locationHint: "Attachment",
      blocks: true,
    });
  }

  if (attachmentPlain && plainBody.split(/\s+/).filter(Boolean).length < 15) {
    issues.push({
      code: "thin_body_with_attachment",
      category: "body_quality",
      message:
        "Body is too thin relative to the attachment — write a genuine message that explains what the document is.",
      locationHint: "Body",
      blocks: true,
    });
  }

  // Regex consistency backup (blocks before/alongside Gemini).
  if (expectAttachment && attachmentPlain) {
    const previewRecipient = buildPreviewRecipientRow(input.previewRecipientEmail);
    const finalCheck = assertFinalPersistedConsistency({
      subject,
      bodyHtml,
      attachmentHtml,
      senderName,
      previewRecipient,
    });
    if (!finalCheck.ok) {
      for (const m of finalCheck.mismatches.slice(0, 4)) {
        issues.push({
          code: "field_consistency_mismatch",
          category: "attachment_mismatch",
          message: m.detail,
          locationHint: "Body + attachment",
          blocks: true,
        });
      }
    }
  }

  // MANDATORY Gemini 2.5 Flash phishing validation — never default PASS.
  const phishingVerdict = await runGeminiPhishingValidation({
    subject,
    bodyPlain: plainBody,
    attachmentPlain,
    senderName,
    hasAttachment: expectAttachment || Boolean(attachmentPlain),
  });

  applyPhishingVerdictToIssues(issues, phishingVerdict);

  const blocking = issues.filter((i) => i.blocks);
  const passed = blocking.length === 0;
  const feedback = toPublicFeedback(issues);

  let suggestedSubject: string | null = null;
  let suggestedHtml: string | null = null;
  let suggestedAttachmentHtml: string | null = null;
  let canonicalFields: CanonicalContentFields | null = null;
  let aiUsed = false;
  let aiNote: string | null = null;

  let summary: string;
  if (!phishingVerdict.executed) {
    summary =
      "Verification could not be completed — send is blocked until this is resolved.";
  } else if (phishingVerdict.status === "PASS" && passed) {
    summary = phishingVerdict.reasoning || "Content passed phishing verification.";
  } else if (phishingVerdict.status === "FAIL" || !passed) {
    summary =
      phishingVerdict.reasoning ||
      "Content did not pass phishing verification — fix issues and re-check.";
  } else {
    summary = "Content did not pass review — fix the issues below, then re-check.";
  }

  const wantAi = opts?.useAi !== false && !passed;
  if (wantAi && isGroundedRewriteConfigured()) {
    const canonical = buildCanonicalContentFields({
      subject,
      plainBody,
      attachmentText: attachmentPlain || null,
      senderName,
      mergeTags,
    });
    canonicalFields = canonical;

    const rewrite = await runConsistentRewrite({
      subject,
      bodyHtml,
      senderName,
      plainBody,
      attachmentCombined: attachmentPlain,
      attachmentHtml,
      feedback,
      mergeTags,
      canonical,
    });

    if (rewrite.ok) {
      aiUsed = true;
      suggestedSubject = rewrite.suggestedSubject;
      suggestedHtml = rewrite.suggestedHtml;
      suggestedAttachmentHtml = rewrite.suggestedAttachmentHtml;
    } else {
      aiNote = rewrite.reason;
    }
  } else if (wantAi && !isGroundedRewriteConfigured()) {
    aiNote = "Add GEMINI_API_KEY for AI-assisted rewrites.";
  }

  return {
    passed,
    feedback,
    issues,
    summary,
    attachmentTextExcerpt: attachmentPlain ? attachmentPlain.slice(0, 2000) : null,
    suggestedSubject,
    suggestedHtml,
    suggestedAttachmentHtml,
    canonicalFields,
    aiUsed,
    aiNote,
    phishingVerdict: {
      executed: phishingVerdict.executed,
      status: phishingVerdict.status,
      mismatches_found: phishingVerdict.mismatches_found,
      flags: phishingVerdict.flags,
      reasoning: phishingVerdict.reasoning,
      rawResponse: phishingVerdict.rawResponse,
      model: phishingVerdict.model,
      error: phishingVerdict.error,
    },
  };
}
