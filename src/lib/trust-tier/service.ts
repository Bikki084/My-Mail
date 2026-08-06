import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { trustTierMetricsLookbackDays } from "@/lib/anti-spam-config";
import { evaluateTrustTierTransition, type TrustMetrics } from "@/lib/trust-tier/evaluate";
import type { TrustTier, TrustTierStatus } from "@/lib/trust-tier/types";

type ProfileRow = {
  id: string;
  trust_tier: TrustTier;
  trust_daily_send_limit: number;
  trust_tier_updated_at: string;
  created_at: string;
};

function startOfUtcDayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function fetchTrustMetrics(
  supabase: SupabaseClient,
  userId: string,
): Promise<TrustMetrics> {
  const lookbackDays = trustTierMetricsLookbackDays();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: sentCount }, { count: bouncedCount }, { count: complaintCount }] =
    await Promise.all([
      supabase
        .from("sending_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "sent")
        .gte("sent_at", since),
      supabase
        .from("sending_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "bounced")
        .gte("sent_at", since),
      supabase
        .from("email_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("event_type", ["spamreport", "spam_report", "complaint"])
        .gte("created_at", since),
    ]);

  const sent = sentCount ?? 0;
  const bounced = bouncedCount ?? 0;
  const complaints = complaintCount ?? 0;
  const denominator = Math.max(1, sent + bounced);

  return {
    sentCount: sent,
    bouncedCount: bounced,
    complaintCount: complaints,
    bounceRate: bounced / denominator,
    complaintRate: complaints / Math.max(1, sent),
  };
}

export async function countSentToday(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("sending_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "sent")
    .gte("sent_at", startOfUtcDayIso());
  if (error) {
    console.warn("[trust-tier] countSentToday failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function loadProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, trust_tier, trust_daily_send_limit, trust_tier_updated_at, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ProfileRow;
}

export async function getTrustTierStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<TrustTierStatus | null> {
  const profile = await loadProfile(supabase, userId);
  if (!profile) return null;
  const sentToday = await countSentToday(supabase, userId);
  const dailyLimit = profile.trust_daily_send_limit;
  return {
    tier: profile.trust_tier,
    dailyLimit,
    sentToday,
    remainingToday: Math.max(0, dailyLimit - sentToday),
    tierUpdatedAt: profile.trust_tier_updated_at,
    accountCreatedAt: profile.created_at,
  };
}

export type DailyQuotaResult =
  | { ok: true; status: TrustTierStatus }
  | { ok: false; message: string; status: TrustTierStatus };

export async function assertDailySendQuota(
  supabase: SupabaseClient,
  userId: string,
  requestedCount: number,
): Promise<DailyQuotaResult> {
  const status = await getTrustTierStatus(supabase, userId);
  if (!status) {
    return {
      ok: false,
      message: "Could not verify account sending limits.",
      status: {
        tier: "new",
        dailyLimit: 0,
        sentToday: 0,
        remainingToday: 0,
        tierUpdatedAt: new Date().toISOString(),
        accountCreatedAt: new Date().toISOString(),
      },
    };
  }

  if (status.tier === "restricted" && status.dailyLimit === 0) {
    return {
      ok: false,
      message:
        "Your account is restricted from sending. Contact support to restore sending privileges.",
      status,
    };
  }

  if (requestedCount > status.remainingToday) {
    return {
      ok: false,
      message: `Daily sending limit reached: ${status.sentToday}/${status.dailyLimit} emails sent today (tier: ${status.tier}). This campaign needs ${requestedCount} but only ${status.remainingToday} remain. Try again tomorrow or contact support.`,
      status,
    };
  }

  return { ok: true, status };
}

export async function evaluateAndUpdateTrustTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const profile = await loadProfile(supabase, userId);
  if (!profile) return;

  const metrics = await fetchTrustMetrics(supabase, userId);
  const evaluation = evaluateTrustTierTransition(
    {
      trustTier: profile.trust_tier,
      trustDailySendLimit: profile.trust_daily_send_limit,
      createdAt: profile.created_at,
      trustTierUpdatedAt: profile.trust_tier_updated_at,
    },
    metrics,
  );

  if (!evaluation.changed) return;

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("profiles")
    .update({
      trust_tier: evaluation.tier,
      trust_daily_send_limit: evaluation.dailyLimit,
      trust_tier_updated_at: now,
    })
    .eq("id", userId);

  if (upErr) {
    console.warn("[trust-tier] profile update failed:", upErr.message);
    return;
  }

  try {
    await supabase.from("client_trust_tier_history").insert({
      user_id: userId,
      from_tier: profile.trust_tier,
      to_tier: evaluation.tier,
      reason: evaluation.reason,
      metrics: {
        bounceRate: evaluation.metrics.bounceRate,
        complaintRate: evaluation.metrics.complaintRate,
        sentCount: evaluation.metrics.sentCount,
        bouncedCount: evaluation.metrics.bouncedCount,
        complaintCount: evaluation.metrics.complaintCount,
        previousDailyLimit: profile.trust_daily_send_limit,
        newDailyLimit: evaluation.dailyLimit,
      },
    });
  } catch (e) {
    console.warn("[trust-tier] history insert failed:", e);
  }
}

export async function listTrustTierClientsForAdmin(
  supabase: SupabaseClient,
): Promise<
  Array<{
    userId: string;
    email: string;
    fullName: string | null;
    tier: TrustTier;
    dailyLimit: number;
    sentToday: number;
    remainingToday: number;
  }>
> {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, trust_tier, trust_daily_send_limit")
    .eq("role", "client")
    .order("email");
  if (error || !profiles) return [];

  const dayStart = startOfUtcDayIso();
  const rows = await Promise.all(
    profiles.map(async (p) => {
      const { count } = await supabase
        .from("sending_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", p.id)
        .eq("status", "sent")
        .gte("sent_at", dayStart);
      const sentToday = count ?? 0;
      const dailyLimit = p.trust_daily_send_limit ?? 30;
      return {
        userId: p.id,
        email: p.email,
        fullName: p.full_name,
        tier: (p.trust_tier ?? "new") as TrustTier,
        dailyLimit,
        sentToday,
        remainingToday: Math.max(0, dailyLimit - sentToday),
      };
    }),
  );
  return rows;
}
