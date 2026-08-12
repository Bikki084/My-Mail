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
  assertCrossArtifactConsistency,
  assertPhishingIndicatorSanity,
} from "@/lib/content-genuineness/consistency";
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

function attachmentHtmlFromInput(input: GenuinenessReviewInput): string | null {
  const html = input.attachments?.find((a) => a.htmlText?.trim())?.htmlText?.trim();
  return html || null;
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

    const consistency = assertCrossArtifactConsistency({
      canonical: args.canonical,
      subject: gemini.suggestedSubject,
      bodyHtmlOrText: `${gemini.suggestedHtml}\n${rewritePlain}`,
      attachmentHtmlOrText: gemini.suggestedAttachmentHtml,
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
        canonical: args.canonical,
        subject: gemini.suggestedSubject,
        bodyChars: gemini.suggestedHtml.length,
        attachmentChars: gemini.suggestedAttachmentHtml?.length ?? 0,
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
      parts.push(
        ...consistency.mismatches.map(
          (m) => `- ${m.detail} (expected ${m.expected}; subject=${m.subject ?? "—"} body=${m.body ?? "—"} att=${m.attachment ?? "—"})`,
        ),
      );
    }
    if (!phishing.ok) {
      parts.push(...phishing.reasons.map((r) => `- ${r}`));
    }
    retryNote = parts.join("\n");

    if (attempt === 1) {
      console.warn("[content-genuineness] consistency check failed after retry", {
        canonicalId: canonicalFieldsAuditId(args.canonical),
        canonical: args.canonical,
        mismatches: !consistency.ok ? consistency.mismatches : [],
        phishingReasons: !phishing.ok ? phishing.reasons : [],
      });
      return {
        ok: false,
        reason:
          "Consistency check failed — subject/body/attachment dynamic fields did not match. Please retry.",
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
  const mergeTags = input.mergeTags ?? [];
  const attachmentHtml = attachmentHtmlFromInput(input);

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
  let suggestedAttachmentHtml: string | null = null;
  let canonicalFields: CanonicalContentFields | null = null;
  let aiUsed = false;
  let aiNote: string | null = null;
  let summary = passed
    ? "Content passed genuineness review — Send is unlocked for this message version."
    : "Content did not pass review — fix the issues below or use AI-assisted rewrite, then re-check.";

  const wantAi = opts?.useAi !== false && (!passed || (attachmentCombined && !plainBody));
  if (wantAi && isGroundedRewriteConfigured()) {
    const canonical = buildCanonicalContentFields({
      subject,
      plainBody,
      attachmentText: attachmentCombined || null,
      senderName,
      mergeTags,
    });
    canonicalFields = canonical;

    const rewrite = await runConsistentRewrite({
      subject,
      bodyHtml,
      senderName,
      plainBody,
      attachmentCombined,
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
      summary = passed ? summary : rewrite.summary;
    } else {
      aiNote = rewrite.reason;
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
    suggestedAttachmentHtml,
    canonicalFields,
    aiUsed,
    aiNote,
  };
}
