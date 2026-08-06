import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/admin";

function auditClient(_passed: SupabaseClient | null): SupabaseClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

export async function logContentRejection(
  _supabase: SupabaseClient | null,
  input: {
    userId: string;
    reasonCode: string;
    message: string;
    campaignId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const client = auditClient(_supabase);
  if (!client) return;
  try {
    await client.from("content_rejection_audit").insert({
      user_id: input.userId,
      campaign_id: input.campaignId ?? null,
      reason_code: input.reasonCode,
      message: input.message.slice(0, 4000),
      metadata: input.metadata ?? null,
    });
  } catch (e) {
    console.warn("[anti-spam-audit] content_rejection insert failed:", e);
  }
}

export async function logAttachmentBlock(
  _supabase: SupabaseClient | null,
  input: {
    userId: string;
    filename: string;
    reasonCode: string;
    detectedType: string | null;
    declaredExtension: string | null;
    campaignId?: string | null;
  },
): Promise<void> {
  const client = auditClient(_supabase);
  if (!client) return;
  try {
    await client.from("attachment_block_audit").insert({
      user_id: input.userId,
      campaign_id: input.campaignId ?? null,
      filename: input.filename.slice(0, 500),
      reason_code: input.reasonCode,
      detected_type: input.detectedType,
      declared_extension: input.declaredExtension,
    });
  } catch (e) {
    console.warn("[anti-spam-audit] attachment_block insert failed:", e);
  }
}

export async function logContentRescoreAttempt(
  _supabase: SupabaseClient | null,
  input: {
    userId: string;
    contentFingerprint: string;
    riskLevel: string;
    blocked: boolean;
  },
): Promise<void> {
  const client = auditClient(_supabase);
  if (!client) return;
  try {
    await client.from("content_rescore_audit").insert({
      user_id: input.userId,
      content_fingerprint: input.contentFingerprint.slice(0, 128),
      risk_level: input.riskLevel,
      blocked: input.blocked,
    });
  } catch (e) {
    console.warn("[anti-spam-audit] content_rescore insert failed:", e);
  }
}

export async function logGenuinenessReview(
  _supabase: SupabaseClient | null,
  input: {
    userId: string;
    contentFingerprint: string;
    passed: boolean;
    failedCategories: string[];
    aiSuggested: boolean;
    aiAccepted?: boolean;
    campaignId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const client = auditClient(_supabase);
  if (!client) return;
  try {
    await client.from("content_genuineness_audit").insert({
      user_id: input.userId,
      campaign_id: input.campaignId ?? null,
      content_fingerprint: input.contentFingerprint.slice(0, 128),
      passed: input.passed,
      failed_categories: input.failedCategories,
      ai_suggested: input.aiSuggested,
      ai_accepted: input.aiAccepted ?? false,
      metadata: input.metadata ?? null,
    });
  } catch (e) {
    console.warn("[anti-spam-audit] content_genuineness insert failed:", e);
  }
}
