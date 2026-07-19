"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
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

function getServiceClient(): { ok: true; client: ReturnType<typeof createServiceClient> } | { ok: false; error: string } {
  try {
    return { ok: true, client: createServiceClient() };
  } catch {
    return {
      ok: false,
      error:
        "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (Supabase → Settings → API → service_role).",
    };
  }
}

function rangeBounds(input: {
  from: string;
  to: string;
  startIso?: string;
  endIso?: string;
}) {
  return {
    start: input.startIso ?? startOfLocalDayIso(input.from),
    end: input.endIso ?? endOfLocalDayIso(input.to),
  };
}

export async function countSendingLogsInDateRange(input: {
  from: string;
  to: string;
  campaignId?: string;
  startIso?: string;
  endIso?: string;
}): Promise<ActionResult<{ count: number }>> {
  const guard = await requireClientUserId();
  if (!guard.ok) return guard;

  const parsed = parseStrict(sendingLogsDateRangeSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { start, end } = rangeBounds(parsed.data);
  const supabase = await createServerSupabase();

  let query = supabase
    .from("sending_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", guard.userId)
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
  startIso?: string;
  endIso?: string;
}): Promise<ActionResult<{ deleted: number }>> {
  const guard = await requireClientUserId();
  if (!guard.ok) return guard;

  const parsed = parseStrict(sendingLogsDateRangeSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const svc = getServiceClient();
  if (!svc.ok) return svc;

  const { start, end } = rangeBounds(parsed.data);

  let countQuery = svc.client
    .from("sending_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", guard.userId)
    .gte("sent_at", start)
    .lte("sent_at", end);

  if (parsed.data.campaignId) {
    countQuery = countQuery.eq("campaign_id", parsed.data.campaignId);
  }

  const { count: matchCount, error: countError } = await countQuery;
  if (countError) return { ok: false, error: countError.message };
  if ((matchCount ?? 0) === 0) {
    return { ok: true, data: { deleted: 0 } };
  }

  let deleteQuery = svc.client
    .from("sending_logs")
    .delete()
    .eq("user_id", guard.userId)
    .gte("sent_at", start)
    .lte("sent_at", end);

  if (parsed.data.campaignId) {
    deleteQuery = deleteQuery.eq("campaign_id", parsed.data.campaignId);
  }

  const { error } = await deleteQuery;

  if (error) return { ok: false, error: error.message };

  invalidateAdminStatsCache();
  return { ok: true, data: { deleted: matchCount ?? 0 } };
}
