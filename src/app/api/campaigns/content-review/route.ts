import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  assertContentRescoreAllowed,
  contentReviewFingerprint,
} from "@/lib/content-spam-review/rescore-limit";
import { validateCampaignComposeRequired } from "@/lib/campaign-compose-validation";
import { validateContentQuality } from "@/lib/content-quality-validation";
import {
  logContentRejection,
  logContentRescoreAttempt,
  logGenuinenessReview,
} from "@/lib/anti-spam-audit";
import {
  attachmentListFingerprint,
  issueGenuinenessPassToken,
  messageContentFingerprint,
  runGenuinenessReview,
  type GenuinenessAttachmentInput,
} from "@/lib/content-genuineness";
import { generateCampaignFromBrief } from "@/lib/content-genuineness/ai-generate-campaign";
import { analyzeContentHeuristics } from "@/lib/content-spam-review/heuristics";
import { contentGenuinenessGateEnabled } from "@/lib/anti-spam-config";
import { normalizeMergeTagKeys } from "@/lib/content-spam-review/merge-tags-prompt";
import { z } from "zod";
import { formatZodError } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * INTERNAL: Strong heuristic + AI gate before ESP — not a guarantee of zero spam
 * complaints. Trust tiers remain the primary list/volume defense.
 */

const attachmentSchema = z.object({
  filename: z.string().max(500),
  contentBase64: z.string().max(8_000_000).optional(),
  htmlText: z.string().max(500_000).optional(),
});

const bodySchema = z.object({
  subject: z.string().max(998),
  body_html: z.string().max(500_000),
  sender_name: z.string().max(80),
  use_ai: z.boolean().optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  /** CSV / built-in merge tag keys for AI personalization (e.g. name, email). */
  merge_tags: z.array(z.string().max(64)).max(40).optional(),
  /** First CSV recipient — expands merge tags for final body/attachment consistency check. */
  preview_recipient_email: z.string().email().optional(),
  /** True when composer has PDF/image attachment configured — attachment must be verified. */
  expect_attachment: z.boolean().optional(),
  /** manual = user-authored content; ai_generate = generate from ai_brief first. */
  compose_mode: z.enum(["manual", "ai_generate"]).optional(),
  ai_brief: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const composeMode = parsed.data.compose_mode ?? "manual";
  const mergeTags = normalizeMergeTagKeys(parsed.data.merge_tags);

  let subject = parsed.data.subject;
  let bodyHtml = parsed.data.body_html;
  const senderName = parsed.data.sender_name;
  let attachments: GenuinenessAttachmentInput[] = (parsed.data.attachments ?? []).map((a) => ({
    filename: a.filename,
    contentBase64: a.contentBase64,
    htmlText: a.htmlText,
  }));
  let generatedContent: {
    subject: string;
    bodyHtml: string;
    attachmentHtml: string;
  } | null = null;

  if (composeMode === "ai_generate") {
    const brief = (parsed.data.ai_brief ?? "").trim();
    if (!brief) {
      return NextResponse.json(
        { error: "AI brief is required for AI-Generate mode.", passed: false, blocked: true },
        { status: 400 },
      );
    }
    const generated = await generateCampaignFromBrief({
      brief,
      senderName,
      mergeTags,
    });
    if (!generated.ok) {
      return NextResponse.json(
        {
          error: generated.reason,
          passed: false,
          blocked: true,
          summary: "AI generation failed — send is blocked.",
        },
        { status: 502 },
      );
    }
    subject = generated.subject;
    bodyHtml = generated.bodyHtml;
    attachments = [
      { filename: "generated-html-attachment", htmlText: generated.attachmentHtml },
    ];
    generatedContent = {
      subject: generated.subject,
      bodyHtml: generated.bodyHtml,
      attachmentHtml: generated.attachmentHtml,
    };
  }

  const compose = validateCampaignComposeRequired({
    senderName,
    subject,
    bodyHtml,
  });
  if (!compose.ok) {
    void logContentRejection(supabase, {
      userId: user.id,
      reasonCode: "compose_required",
      message: compose.message,
    });
    return NextResponse.json({ error: compose.message, blocked: true, passed: false }, { status: 400 });
  }

  const attachmentBytes = attachments.reduce((sum, a) => {
    if (!a.contentBase64) return sum;
    try {
      return sum + Buffer.from(a.contentBase64, "base64").byteLength;
    } catch {
      return sum;
    }
  }, 0);

  const quality = validateContentQuality({
    bodyHtml,
    attachmentTotalBytes: attachmentBytes,
  });
  if (!quality.ok) {
    void logContentRejection(supabase, {
      userId: user.id,
      reasonCode: quality.code,
      message: quality.message,
      metadata: {
        wordCount: quality.wordCount,
        minWords: quality.minWords,
      },
    });
    return NextResponse.json({ error: quality.message, blocked: true, passed: false }, { status: 400 });
  }

  const attFp = attachmentListFingerprint(attachments);
  const fingerprint = messageContentFingerprint({
    subject,
    bodyHtml,
    senderName,
    attachmentFingerprint: attFp,
  });

  const legacyFp = contentReviewFingerprint({
    subject,
    bodyHtml,
    senderName,
  });

  let service;
  try {
    service = createServiceClient();
  } catch {
    service = supabase;
  }

  const rateLimit = await assertContentRescoreAllowed(service, user.id, legacyFp);
  if (!rateLimit.ok) {
    void logContentRescoreAttempt(service, {
      userId: user.id,
      contentFingerprint: legacyFp,
      riskLevel: "rate_limited",
      blocked: true,
    });
    return NextResponse.json(
      {
        error: rateLimit.message,
        blocked: true,
        passed: false,
        retryAfterMinutes: rateLimit.retryAfterMinutes,
      },
      { status: 429 },
    );
  }

  const expectAttachment =
    parsed.data.expect_attachment === true ||
    composeMode === "ai_generate" ||
    attachments.some((a) => Boolean(a.htmlText?.trim() || a.contentBase64?.trim()));

  const genuineness = await runGenuinenessReview(
    {
      subject,
      bodyHtml,
      senderName,
      attachments,
      mergeTags,
      previewRecipientEmail: parsed.data.preview_recipient_email,
      expectAttachment,
    },
    { useAi: parsed.data.use_ai },
  );

  const heuristics = analyzeContentHeuristics({
    subject,
    bodyHtml,
    senderName,
  });

  const gateOn = contentGenuinenessGateEnabled();
  const passed = gateOn ? genuineness.passed : genuineness.passed && heuristics.level !== "high";

  const passToken =
    passed
      ? issueGenuinenessPassToken({ userId: user.id, fingerprint })
      : null;

  void logContentRescoreAttempt(service, {
    userId: user.id,
    contentFingerprint: legacyFp,
    riskLevel: passed ? "pass" : heuristics.level,
    blocked: !passed,
  });

  void logGenuinenessReview(service, {
    userId: user.id,
    contentFingerprint: fingerprint,
    passed,
    failedCategories: [...new Set(genuineness.feedback.map((f) => f.category))],
    aiSuggested: genuineness.aiUsed,
    metadata: {
      issueCodes: genuineness.issues.map((i) => i.code),
      advisoryRiskLevel: heuristics.level,
      canonicalFields: genuineness.canonicalFields,
      suggestedSubject: genuineness.suggestedSubject,
      suggestedHtmlChars: genuineness.suggestedHtml?.length ?? 0,
      suggestedAttachmentHtmlChars: genuineness.suggestedAttachmentHtml?.length ?? 0,
      phishingStatus: genuineness.phishingVerdict.status,
      phishingRawResponse: genuineness.phishingVerdict.rawResponse?.slice(0, 4000) ?? null,
    },
  });

  return NextResponse.json({
    /** Hard gate — Send must stay disabled until true for this message version. */
    passed,
    passToken,
    contentFingerprint: fingerprint,
    /** Advisory risk level (no numeric score). */
    riskLevel: heuristics.level,
    feedback: genuineness.feedback,
    issues: genuineness.feedback.map((f) => ({
      code: f.category,
      message: f.message,
      locationHint: f.locationHint,
    })),
    summary: genuineness.summary,
    suggestedSubject: genuineness.suggestedSubject,
    suggestedHtml: genuineness.suggestedHtml,
    suggestedAttachmentHtml: genuineness.suggestedAttachmentHtml,
    canonicalFields: genuineness.canonicalFields,
    aiUsed: genuineness.aiUsed,
    aiNote: genuineness.aiNote,
    phishingVerdict: genuineness.phishingVerdict,
    generatedContent,
    rescoringRemaining: rateLimit.remaining,
    gateRequired: gateOn,
  });
}
