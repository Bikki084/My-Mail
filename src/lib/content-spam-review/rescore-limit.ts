import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contentRescoreMaxAttempts,
  contentRescoreWindowMinutes,
} from "@/lib/anti-spam-config";
import { contentReviewFingerprint } from "@/lib/content-spam-review/fingerprint";

export { contentReviewFingerprint };

export async function countRecentRescoreAttempts(
  supabase: SupabaseClient,
  userId: string,
  fingerprint: string,
): Promise<number> {
  const windowMs = contentRescoreWindowMinutes() * 60 * 1000;
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count, error } = await supabase
    .from("content_rescore_audit")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("content_fingerprint", fingerprint)
    .gte("created_at", since);
  if (error) return 0;
  return count ?? 0;
}

export type RescoreRateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; message: string; retryAfterMinutes: number };

export async function assertContentRescoreAllowed(
  supabase: SupabaseClient,
  userId: string,
  fingerprint: string,
): Promise<RescoreRateLimitResult> {
  const max = contentRescoreMaxAttempts();
  const windowMin = contentRescoreWindowMinutes();
  const used = await countRecentRescoreAttempts(supabase, userId, fingerprint);
  if (used >= max) {
    return {
      ok: false,
      message: `Too many spam-risk checks for this message (${max} per ${windowMin} minutes). Wait before rechecking or contact support.`,
      retryAfterMinutes: windowMin,
    };
  }
  return { ok: true, remaining: max - used - 1 };
}
