import type { SupabaseClient } from "@supabase/supabase-js";
import { allowSendWithoutActivePlan } from "@/lib/active-plan-guard";
import { countUserSmtpServers } from "@/lib/campaign-send-preflight";

export type SmtpPlanCapacity = {
  current: number;
  /** null = unlimited (active plan allows unlimited SMTP slots). */
  limit: number | null;
  canAdd: boolean;
  /** How many more rows the user may insert (null = unlimited). */
  remaining: number | null;
  hasActivePlan: boolean;
};

function planExpiresAtValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

/**
 * Active plan server slot limit for this user (`servers_allowed` on `active_plans`).
 * Returns null when unlimited or when no active plan (and dev bypass is off).
 */
export async function getActivePlanServerLimit(
  supabase: SupabaseClient,
  userId: string,
): Promise<number | null> {
  if (allowSendWithoutActivePlan()) return null;

  const { data, error } = await supabase
    .from("active_plans")
    .select("servers_allowed, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data || !planExpiresAtValid(data.expires_at)) return 0;
  const raw = data.servers_allowed;
  if (raw == null) return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function getSmtpPlanCapacity(
  supabase: SupabaseClient,
  userId: string,
): Promise<SmtpPlanCapacity> {
  const current = await countUserSmtpServers(supabase, userId);
  if (allowSendWithoutActivePlan()) {
    return {
      current,
      limit: null,
      canAdd: true,
      remaining: null,
      hasActivePlan: true,
    };
  }

  const { data, error } = await supabase
    .from("active_plans")
    .select("servers_allowed, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  const hasActivePlan =
    !error && data != null && planExpiresAtValid(data.expires_at);

  if (!hasActivePlan) {
    return {
      current,
      limit: 0,
      canAdd: false,
      remaining: 0,
      hasActivePlan: false,
    };
  }

  const limit = await getActivePlanServerLimit(supabase, userId);
  if (limit === null) {
    return {
      current,
      limit: null,
      canAdd: true,
      remaining: null,
      hasActivePlan: true,
    };
  }

  const remaining = Math.max(0, limit - current);
  return {
    current,
    limit,
    canAdd: remaining > 0,
    remaining,
    hasActivePlan: true,
  };
}

export function formatSmtpPlanLimitMessage(cap: SmtpPlanCapacity): string {
  if (!cap.hasActivePlan) {
    return "Activate a server plan under Wallet & Plan before adding SMTP servers.";
  }
  if (cap.limit === null) return "Unlimited SMTP servers on your active plan.";
  return `${cap.current} of ${cap.limit} SMTP server slots used on your active plan.`;
}

/**
 * Gate new SMTP inserts (not updates). Returns an error string or null if allowed.
 */
export async function evaluateSmtpInsertCapacity(
  supabase: SupabaseClient,
  userId: string,
  slotsToAdd: number,
): Promise<string | null> {
  const add = Math.max(0, Math.floor(slotsToAdd));
  if (add === 0) return null;

  const cap = await getSmtpPlanCapacity(supabase, userId);
  if (!cap.hasActivePlan) {
    return "Activate a server plan under Wallet & Plan before adding SMTP servers.";
  }
  if (cap.limit === null) return null;

  const after = cap.current + add;
  if (after > cap.limit) {
    const need = after - cap.limit;
    return `Your active plan allows ${cap.limit} SMTP server(s). You have ${cap.current} saved and tried to add ${add}. Remove ${need} row(s) or upgrade your plan.`;
  }
  return null;
}

/** Clamp a loaded SMTP list to the user's plan limit (first N by rotation order). */
export function clampSmtpRowsToPlanLimit<T>(
  rows: T[],
  limit: number | null,
): T[] {
  if (limit === null || limit <= 0) return rows;
  return rows.slice(0, limit);
}
