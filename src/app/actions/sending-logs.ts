"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { invalidateAdminStatsCache } from "@/lib/cache/invalidate";
import { endOfLocalDayIso, startOfLocalDayIso } from "@/lib/sending-log-dates";
import { parseStrict, sendingLogsDateRangeSchema } from "@/lib/validation";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireClientUserId(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Profile missing." };
  if (profile.role !== "client" && profile.role !== "admin") {
    return { ok: false, error: "Client access required." };
  }

  return { ok: true, userId: user.id };
}

function rangeBounds(from: string, to: string) {
  return {
    start: startOfLocalDayIso(from),
    end: endOfLocalDayIso(to),
  };
}

export async function countSendingLogsInDateRange(input: {
  from: string;
  to: string;
  campaignId?: string;
}): Promise<ActionResult<{ count: number }>> {
  const guard = await requireClientUserId();
  if (!guard.ok) return guard;
  const userId = guard.userId;

  const parsed = parseStrict(sendingLogsDateRangeSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { start, end } = rangeBounds(parsed.data.from, parsed.data.to);
  const supabase = await createServerSupabase();

  let query = supabase
    .from("sending_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("sent_at", start)
    .lte("sent_at", end);

  if (parsed.data.campaignId) {
    query = query.eq("campaign_id", parsed.data.campaignId);
  }

  const { count, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { count: count ?? 0 } };
}

export async function deleteSendingLogsInDateRange(input: {
  from: string;
  to: string;
  campaignId?: string;
}): Promise<ActionResult<{ deleted: number }>> {
  const guard = await requireClientUserId();
  if (!guard.ok) return guard;
  const userId = guard.userId;

  const parsed = parseStrict(sendingLogsDateRangeSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { start, end } = rangeBounds(parsed.data.from, parsed.data.to);
  const supabase = await createServerSupabase();

  let query = supabase
    .from("sending_logs")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .gte("sent_at", start)
    .lte("sent_at", end);

  if (parsed.data.campaignId) {
    query = query.eq("campaign_id", parsed.data.campaignId);
  }

  const { count, error } = await query;
  if (error) return { ok: false, error: error.message };

  invalidateAdminStatsCache();
  return { ok: true, data: { deleted: count ?? 0 } };
}
