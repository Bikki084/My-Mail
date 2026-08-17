import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCampaignComposeRequired } from "@/lib/campaign-compose-validation";
import { validateContentQuality } from "@/lib/content-quality-validation";
import {
  attachmentTotalBytes,
  attachmentsFromBase64Rows,
  validateAllAttachments,
} from "@/lib/attachment-security";
import {
  logAttachmentBlock,
  logContentRejection,
} from "@/lib/anti-spam-audit";
import { assertDailySendQuota } from "@/lib/trust-tier/service";
import {
  analyzeContentHeuristics,
  type ContentRiskLevel,
} from "@/lib/content-spam-review/heuristics";
import {
  contentGenuinenessGateEnabled,
  contentSpamBlockHighRisk,
  contentSpamBlockMediumRisk,
} from "@/lib/anti-spam-config";
import {
  attachmentListFingerprint,
  messageBodyContentFingerprint,
  runGenuinenessReview,
  verifyGenuinenessPassToken,
} from "@/lib/content-genuineness";

export type CampaignGuardInput = {
  senderName: string;
  subject: string;
  bodyHtml: string;
  attachments?: { filename: string; contentBase64?: string; htmlText?: string }[];
};

export type CampaignGuardResult =
  | { ok: true }
  | { ok: false; message: string; code: string; status: number };

export async function runCampaignContentGuards(
  supabase: SupabaseClient | null,
  userId: string,
  input: CampaignGuardInput,
  opts?: { campaignId?: string | null },
): Promise<CampaignGuardResult> {
  const compose = validateCampaignComposeRequired({
    senderName: input.senderName,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
  });
  if (!compose.ok) {
    void logContentRejection(supabase, {
      userId,
      reasonCode: "compose_required",
      message: compose.message,
      campaignId: opts?.campaignId,
    });
    return { ok: false, message: compose.message, code: "compose_required", status: 400 };
  }

  const attachmentRows = (input.attachments ?? [])
    .filter((a): a is { filename: string; contentBase64: string; htmlText?: string } =>
      Boolean(a.contentBase64 && a.contentBase64.trim()),
    )
    .map((a) => ({ filename: a.filename, contentBase64: a.contentBase64 }));
  const decoded = attachmentsFromBase64Rows(attachmentRows);
  const attachSecurity = validateAllAttachments(decoded);
  if (!attachSecurity.ok) {
    void logAttachmentBlock(supabase, {
      userId,
      filename: attachSecurity.filename,
      reasonCode: attachSecurity.code,
      detectedType: attachSecurity.detectedKind ?? null,
      declaredExtension: attachSecurity.declaredExtension ?? null,
      campaignId: opts?.campaignId,
    });
    return {
      ok: false,
      message: attachSecurity.message,
      code: attachSecurity.code,
      status: 400,
    };
  }

  const totalBytes = attachmentTotalBytes(decoded);
  const quality = validateContentQuality({
    bodyHtml: input.bodyHtml,
    attachmentTotalBytes: totalBytes,
  });
  if (!quality.ok) {
    void logContentRejection(supabase, {
      userId,
      reasonCode: quality.code,
      message: quality.message,
      campaignId: opts?.campaignId,
      metadata: {
        wordCount: quality.wordCount,
        minWords: quality.minWords,
        textLength: quality.textLength,
        attachmentBytes: quality.attachmentBytes,
      },
    });
    return {
      ok: false,
      message: quality.message,
      code: quality.code,
      status: 400,
    };
  }

  return { ok: true };
}

export function assessContentSpamRisk(input: {
  subject: string;
  bodyHtml: string;
  senderName: string;
}): { level: ContentRiskLevel; issues: { code: string; message: string }[] } {
  const result = analyzeContentHeuristics(input);
  return {
    level: result.level,
    issues: result.issues.map(({ code, message }) => ({ code, message })),
  };
}

export async function runContentSpamRiskGuard(
  supabase: SupabaseClient | null,
  userId: string,
  input: Pick<CampaignGuardInput, "subject" | "bodyHtml" | "senderName">,
  opts?: { campaignId?: string | null },
): Promise<CampaignGuardResult> {
  const risk = assessContentSpamRisk(input);
  const blockHigh = contentSpamBlockHighRisk();
  const blockMedium = contentSpamBlockMediumRisk();

  const shouldBlock =
    (blockHigh && risk.level === "high") || (blockMedium && risk.level === "medium");

  if (!shouldBlock) return { ok: true };

  const topIssues = risk.issues.slice(0, 3).map((i) => i.message).join(" ");
  const message =
    risk.level === "high"
      ? `High spam risk — sending blocked. Use “Check spam risk” in the composer and apply the suggested rewrite. ${topIssues}`.trim()
      : `Medium spam risk — sending blocked (server policy). Improve content using “Check spam risk” before sending. ${topIssues}`.trim();

  void logContentRejection(supabase, {
    userId,
    reasonCode: `spam_risk_${risk.level}`,
    message,
    campaignId: opts?.campaignId,
    metadata: { issues: risk.issues },
  });

  return {
    ok: false,
    message,
    code: `spam_risk_${risk.level}`,
    status: 400,
  };
}

/**
 * Hard pre-send genuineness gate: valid pass token for this message version +
 * fresh server-side review (no AI). Does not weaken existing spam-risk guards.
 */
export async function runGenuinenessPassGuard(
  supabase: SupabaseClient | null,
  userId: string,
  input: CampaignGuardInput & { passToken?: string | null },
  opts?: { campaignId?: string | null },
): Promise<CampaignGuardResult> {
  if (!contentGenuinenessGateEnabled()) return { ok: true };

  const attFp = attachmentListFingerprint(
    (input.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentBase64: a.contentBase64,
      htmlText: a.htmlText,
    })),
  );
  const fingerprint = messageBodyContentFingerprint({
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    senderName: input.senderName,
  });

  const token = (input.passToken ?? "").trim();
  if (!token) {
    const message =
      "Content verification required — run “Verify content” in the composer and wait for a pass before sending.";
    void logContentRejection(supabase, {
      userId,
      reasonCode: "genuineness_token_missing",
      message,
      campaignId: opts?.campaignId,
    });
    return { ok: false, message, code: "genuineness_required", status: 400 };
  }

  const verified = verifyGenuinenessPassToken({
    token,
    userId,
    fingerprint,
    attachmentFingerprint: attFp,
  });
  if (!verified.ok) {
    void logContentRejection(supabase, {
      userId,
      reasonCode: "genuineness_token_invalid",
      message: verified.reason,
      campaignId: opts?.campaignId,
      metadata: { fingerprint },
    });
    return { ok: false, message: verified.reason, code: "genuineness_required", status: 400 };
  }

  // With no current attachment there is no attachment payload to inspect.
  // The signed token already binds the exact subject/body/sender, so allow the
  // verified body-only message without a second Gemini call at campaign create
  // and again at send. Any body edit changes the fingerprint and fails above.
  if (!attFp) {
    return { ok: true };
  }

  // Re-validate on server (no AI) so a stolen/stale token cannot bypass content rules.
  const hasAttachment = (input.attachments ?? []).some(
    (a) => Boolean(a.htmlText?.trim() || a.contentBase64?.trim()),
  );
  const review = await runGenuinenessReview(
    {
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      senderName: input.senderName,
      attachments: (input.attachments ?? []).map((a) => ({
        filename: a.filename,
        contentBase64: a.contentBase64,
        htmlText: a.htmlText,
      })),
      expectAttachment: hasAttachment,
    },
    { useAi: false },
  );

  if (!review.passed) {
    const top = review.feedback
      .slice(0, 3)
      .map((f) => f.message)
      .join(" ");
    const message = `Content verification failed on the server. ${top}`.trim();
    void logContentRejection(supabase, {
      userId,
      reasonCode: "genuineness_failed",
      message,
      campaignId: opts?.campaignId,
      metadata: { categories: review.feedback.map((f) => f.category) },
    });
    return { ok: false, message, code: "genuineness_failed", status: 400 };
  }

  return { ok: true };
}

export async function runTrustTierSendGuard(
  supabase: SupabaseClient,
  userId: string,
  recipientCount: number,
): Promise<CampaignGuardResult> {
  const quota = await assertDailySendQuota(supabase, userId, recipientCount);
  if (!quota.ok) {
    return {
      ok: false,
      message: quota.message,
      code: "daily_limit",
      status: 429,
    };
  }
  return { ok: true };
}
