import type { SupabaseClient } from "@supabase/supabase-js";
import { removeCampaignJobsFromQueue } from "@/lib/queue/remove-campaign-jobs";

/** Written to `campaigns.pause_reason` when a plan is cancelled mid-flight. */
export const PLAN_CANCEL_PAUSE_REASON = "plan_cancelled";

export const UNFINISHED_CAMPAIGN_STATUSES = [
  "queued",
  "sending",
  "paused",
] as const;

export type UnfinishedCampaignStatus = (typeof UNFINISHED_CAMPAIGN_STATUSES)[number];

const CANCEL_MESSAGE =
  "Stopped: active plan was cancelled by the user. Already-sent emails remain in the delivery log.";

export async function isCampaignCancelled(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .maybeSingle();
  if (error || !data) return false;
  return data.status === "cancelled";
}

/**
 * Polls `campaigns.status` at most once per second so parallel SMTP workers
 * can stop soon after plan cancellation without hammering the database.
 */
export function createCampaignAbortChecker(
  supabase: SupabaseClient,
  campaignId: string,
) {
  let lastCheckMs = 0;
  let cached = false;
  return async function shouldAbortCampaign(): Promise<boolean> {
    const now = Date.now();
    if (lastCheckMs > 0 && now - lastCheckMs < 1000) {
      return cached;
    }
    lastCheckMs = now;
    cached = await isCampaignCancelled(supabase, campaignId);
    return cached;
  };
}

export async function countUnfinishedCampaigns(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", [...UNFINISHED_CAMPAIGN_STATUSES]);

  if (error) {
    console.warn("[campaign-cancel] count unfinished:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Marks in-flight campaigns as `cancelled`, removes their BullMQ jobs, and
 * leaves `sending_logs` untouched.
 */
export async function cancelUnfinishedCampaignsForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<{ cancelledIds: string[] }> {
  const { data: rows, error: listErr } = await admin
    .from("campaigns")
    .select("id")
    .eq("user_id", userId)
    .in("status", [...UNFINISHED_CAMPAIGN_STATUSES]);

  if (listErr) {
    throw new Error(listErr.message);
  }

  const ids = (rows ?? []).map((r) => r.id as string).filter(Boolean);
  if (ids.length === 0) {
    return { cancelledIds: [] };
  }

  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from("campaigns")
    .update({
      status: "cancelled",
      pause_reason: PLAN_CANCEL_PAUSE_REASON,
      paused_at: now,
      last_error: CANCEL_MESSAGE.slice(0, 2000),
      updated_at: now,
    })
    .in("id", ids);

  if (upErr) {
    const msg = upErr.message ?? "";
    if (msg.includes("campaigns_status_check") || msg.includes("violates check")) {
      throw new Error(
        "Campaign cancel status is not available in the database. Run migration supabase/migrations/20260520120000_campaign_cancelled_status.sql",
      );
    }
    throw new Error(upErr.message);
  }

  try {
    await removeCampaignJobsFromQueue(ids);
  } catch (e) {
    console.warn("[campaign-cancel] queue cleanup:", e);
  }

  console.log(
    `[campaign-cancel] user=${userId} cancelled ${ids.length} campaign(s): ${ids.join(", ")}`,
  );

  return { cancelledIds: ids };
}
