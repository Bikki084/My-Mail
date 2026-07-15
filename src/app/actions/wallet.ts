"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { findPlan, PLANS, type Plan } from "@/lib/plans";
import { cancelActivePlanForUser } from "@/lib/wallet-plan-cancel";
import { countUnfinishedCampaigns } from "@/lib/campaign-cancel";
import { resetOutboundIpRotationForNewPlan } from "@/lib/outbound-ip";
import { parseStrict, planIdField } from "@/lib/validation";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type ActivePlanState = {
  planId: string;
  serversAllowed: number | null;
  startedAt: string;
  expiresAt: string;
  /** True if `expiresAt <= now()` server-side at fetch time. */
  expired: boolean;
};

export type WalletState = {
  balance: number;
  activePlan: ActivePlanState | null;
};

export type CancelPlanResult = WalletState & {
  cancelledCampaigns: number;
};

const EMPTY_STATE: WalletState = { balance: 0, activePlan: null };

const MIGRATION_HINT =
  "Wallet schema not found in Supabase. Run supabase/migrations/20260428120000_wallet_and_plans.sql in the Supabase SQL Editor.";

function isMissingWalletSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "42P01") return true;
  const msg = (err.message ?? "").toLowerCase();
  return (
    msg.includes("wallet_balance") ||
    msg.includes("wallet_transactions") ||
    msg.includes("active_plans")
  );
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

/**
 * Reads the signed-in client's wallet balance and active plan (if any).
 * Returns zeroed state if the user is unauthenticated.
 */
export async function getWalletState(): Promise<WalletState> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return EMPTY_STATE;

  const [creditsRes, planRes] = await Promise.all([
    supabase
      .from("credits")
      .select("wallet_balance")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("active_plans")
      .select("plan_id, servers_allowed, started_at, expires_at")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // If the migration hasn't been applied yet, fall back to empty state so
  // the client dashboard still renders (with a zero balance) instead of crashing.
  if (
    isMissingWalletSchema(creditsRes.error) ||
    isMissingWalletSchema(planRes.error)
  ) {
    return EMPTY_STATE;
  }

  const balance = Math.max(
    0,
    Math.floor(Number(creditsRes.data?.wallet_balance ?? 0)),
  );

  const planRow = planRes.data;
  const activePlan: ActivePlanState | null = planRow
    ? {
        planId: planRow.plan_id,
        serversAllowed: planRow.servers_allowed,
        startedAt: planRow.started_at,
        expiresAt: planRow.expires_at,
        expired: isExpired(planRow.expires_at),
      }
    : null;

  return { balance, activePlan };
}

/**
 * Activates the requested plan for the signed-in client.
 *
 * Rules:
 *  - User must be a client (not admin).
 *  - User must have wallet_balance >= plan.cost.
 *  - If a plan is already active and not expired, activation is rejected
 *    (plans are non-stackable; the timer must run out first).
 *  - On success: balance decremented, active_plans row upserted,
 *    wallet_transactions audit row inserted.
 */
export async function activatePlan(
  planId: string,
): Promise<ActionResult<WalletState>> {
  const parsed = parseStrict(planIdField, planId);
  if (!parsed.ok) return { ok: false, error: "Unknown plan." };
  const plan = findPlan(parsed.data);
  if (!plan) return { ok: false, error: "Unknown plan." };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local.",
    };
  }

  // Make sure the actor is a client (admins cannot activate plans for themselves).
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) return { ok: false, error: profileErr.message };
  if (!profile || profile.role !== "client") {
    return { ok: false, error: "Only client accounts can activate plans." };
  }

  // Enforce non-stackable plans.
  const { data: existing, error: existingErr } = await admin
    .from("active_plans")
    .select("expires_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingErr) {
    if (isMissingWalletSchema(existingErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: existingErr.message };
  }
  if (existing && !isExpired(existing.expires_at)) {
    return {
      ok: false,
      error:
        "You already have an active plan. Wait for it to expire before activating another.",
    };
  }

  // Check balance.
  const { data: creditsRow, error: creditsErr } = await admin
    .from("credits")
    .select("wallet_balance")
    .eq("user_id", user.id)
    .maybeSingle();
  if (creditsErr) {
    if (isMissingWalletSchema(creditsErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: creditsErr.message };
  }
  const balance = Math.max(
    0,
    Math.floor(Number(creditsRow?.wallet_balance ?? 0)),
  );
  if (balance < plan.cost) {
    return {
      ok: false,
      error: `Insufficient balance. Need ${plan.cost - balance} more credits.`,
    };
  }

  const startedAt = new Date();
  const expiresAt = new Date(
    startedAt.getTime() + plan.durationHours * 60 * 60 * 1000,
  );

  // Deduct balance (upsert to be safe in case credits row is missing).
  const { error: deductErr } = await admin
    .from("credits")
    .upsert(
      {
        user_id: user.id,
        wallet_balance: balance - plan.cost,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (deductErr) {
    if (isMissingWalletSchema(deductErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: deductErr.message };
  }

  // Replace any prior (expired) plan row.
  const { error: planErr } = await admin
    .from("active_plans")
    .upsert(
      {
        user_id: user.id,
        plan_id: plan.id,
        servers_allowed: plan.serversAllowed,
        started_at: startedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (planErr) {
    if (isMissingWalletSchema(planErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: planErr.message };
  }

  try {
    await resetOutboundIpRotationForNewPlan(admin, user.id);
  } catch (resetErr) {
    console.warn(
      `[wallet] plan activated but outbound IP reset failed for user=${user.id}: ${
        resetErr instanceof Error ? resetErr.message : String(resetErr)
      }`,
    );
  }

  // Audit.
  const { error: txErr } = await admin.from("wallet_transactions").insert({
    user_id: user.id,
    admin_id: null,
    kind: "plan_purchase",
    amount: -plan.cost,
    plan_id: plan.id,
    note: `Activated ${plan.label}`,
  });
  if (txErr) {
    if (isMissingWalletSchema(txErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: txErr.message };
  }

  revalidatePath("/client");
  revalidatePath("/client/overview");
  revalidatePath("/client/smtp");
  revalidatePath("/admin/reports");

  const newState: WalletState = {
    balance: balance - plan.cost,
    activePlan: {
      planId: plan.id,
      serversAllowed: plan.serversAllowed,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expired: false,
    },
  };
  return { ok: true, data: newState };
}

/**
 * Cancels the user's current active plan immediately.
 * Wallet balance is not refunded; purchase history remains in `wallet_transactions`.
 */
/** How many campaigns would be stopped if the user cancels their plan now. */
export async function getUnfinishedCampaignCount(): Promise<number> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  return countUnfinishedCampaigns(supabase, user.id);
}

export async function cancelActivePlan(): Promise<ActionResult<CancelPlanResult>> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local.",
    };
  }

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) return { ok: false, error: profileErr.message };
  if (!profile || profile.role !== "client") {
    return { ok: false, error: "Only client accounts can cancel plans." };
  }

  const result = await cancelActivePlanForUser(admin, user.id);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/client");
  revalidatePath("/client/overview");
  revalidatePath("/admin/reports");

  return {
    ok: true,
    data: {
      ...result.state,
      cancelledCampaigns: result.cancelledCampaigns,
    },
  };
}

/** Re-export the plan list so client components can render the dropdown
 * without importing server-only code. */
export async function listPlans(): Promise<readonly Plan[]> {
  return PLANS;
}
