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

export type CampaignGuardInput = {
  senderName: string;
  subject: string;
  bodyHtml: string;
  attachments?: { filename: string; contentBase64: string }[];
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

  const attachmentRows = input.attachments ?? [];
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
