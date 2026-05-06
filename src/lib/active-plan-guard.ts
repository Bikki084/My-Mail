import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

function planExpiresAtValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

function isMissingActivePlansTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42P01") return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("active_plans") && msg.includes("does not exist");
}

/**
 * Local/dev escape hatch, mirroring ALLOW_SEND_WITHOUT_EMAIL_CREDITS.
 * Do not set in production.
 */
export function allowSendWithoutActivePlan(): boolean {
  return process.env.ALLOW_SEND_WITHOUT_ACTIVE_PLAN === "1";
}

export type MailServicePlanResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Whether this user may use outbound mail (active, non-expired row in `active_plans`).
 */
export async function evaluateMailServicePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<MailServicePlanResult> {
  if (allowSendWithoutActivePlan()) return { ok: true };

  const { data, error } = await supabase
    .from("active_plans")
    .select("expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingActivePlansTable(error)) {
      return {
        ok: false,
        error:
          "Server plan feature is not configured. Run wallet/plan migrations (e.g. supabase/migrations/20260428120000_wallet_and_plans.sql), or set ALLOW_SEND_WITHOUT_ACTIVE_PLAN=1 for local testing only.",
        status: 503,
      };
    }
    return {
      ok: false,
      error: "Could not verify your server plan. Try again later.",
      status: 500,
    };
  }

  if (!data || !planExpiresAtValid(data.expires_at)) {
    return {
      ok: false,
      error:
        "You need an active server plan to send email. Open Wallet & Plan, activate a plan with your wallet balance, then try again.",
      status: 403,
    };
  }

  return { ok: true };
}

/**
 * True if the user has a non-expired row in `active_plans` (ignores
 * `ALLOW_SEND_WITHOUT_ACTIVE_PLAN`). Used to gate legacy `email_credits` vs plan-based sending.
 */
export async function hasNonExpiredActivePlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("active_plans")
    .select("expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return planExpiresAtValid(data.expires_at);
}

/**
 * Returns null if the user may send mail; otherwise a JSON error Response.
 * Uses the request-scoped Supabase client (RLS): user must be able to read own `active_plans` row.
 */
export async function requireActivePlanForMailOrJson(
  supabase: SupabaseClient,
  userId: string,
): Promise<Response | null> {
  const r = await evaluateMailServicePlan(supabase, userId);
  if (r.ok) return null;
  return NextResponse.json({ error: r.error }, { status: r.status });
}
