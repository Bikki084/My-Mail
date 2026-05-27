import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlan } from "@/lib/plans";
import { cancelUnfinishedCampaignsForUser } from "@/lib/campaign-cancel";

export type WalletStateSnapshot = {
  balance: number;
  activePlan: null;
};

export function isActivePlanExpired(
  expiresAt: string | null | undefined,
): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

export type CancelActivePlanResult =
  | { ok: true; state: WalletStateSnapshot; cancelledCampaigns: number }
  | { ok: false; error: string; status?: number };

/**
 * Removes the user's non-expired `active_plans` row. Wallet balance is unchanged.
 * Unfinished campaigns are cancelled and queue jobs removed before the plan row is deleted.
 */
export async function cancelActivePlanForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<CancelActivePlanResult> {
  const { data: existing, error: existingErr } = await admin
    .from("active_plans")
    .select("plan_id, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (existingErr) {
    return { ok: false, error: existingErr.message, status: 500 };
  }

  if (!existing) {
    return { ok: false, error: "No active plan to cancel.", status: 404 };
  }

  if (isActivePlanExpired(existing.expires_at)) {
    await admin.from("active_plans").delete().eq("user_id", userId);
    const state = await readWalletState(admin, userId);
    return { ok: true, state, cancelledCampaigns: 0 };
  }

  let cancelledCampaigns = 0;
  try {
    const { cancelledIds } = await cancelUnfinishedCampaignsForUser(
      admin,
      userId,
    );
    cancelledCampaigns = cancelledIds.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 500 };
  }

  const plan = findPlan(existing.plan_id);
  const label = plan?.label ?? existing.plan_id;

  const { error: deleteErr } = await admin
    .from("active_plans")
    .delete()
    .eq("user_id", userId);

  if (deleteErr) {
    return { ok: false, error: deleteErr.message, status: 500 };
  }

  const { error: txErr } = await admin.from("wallet_transactions").insert({
    user_id: userId,
    admin_id: null,
    kind: "plan_cancel",
    amount: 0,
    plan_id: existing.plan_id,
    note: `Cancelled ${label} before expiry${
      cancelledCampaigns > 0
        ? ` (${cancelledCampaigns} campaign${cancelledCampaigns === 1 ? "" : "s"} stopped)`
        : ""
    }`,
  });

  if (txErr) {
    const msg = (txErr.message ?? "").toLowerCase();
    const constraint =
      txErr.code === "23514" ||
      (msg.includes("wallet_transactions") && msg.includes("check"));
    if (!constraint) {
      return { ok: false, error: txErr.message, status: 500 };
    }
    console.warn(
      "[wallet] plan_cancel audit skipped — run migration 20260519120000_wallet_plan_cancel.sql",
    );
  }

  const state = await readWalletState(admin, userId);
  return { ok: true, state, cancelledCampaigns };
}

async function readWalletState(
  admin: SupabaseClient,
  userId: string,
): Promise<WalletStateSnapshot> {
  const { data: creditsRow } = await admin
    .from("credits")
    .select("wallet_balance")
    .eq("user_id", userId)
    .maybeSingle();

  const balance = Math.max(
    0,
    Math.floor(Number(creditsRow?.wallet_balance ?? 0)),
  );

  return { balance, activePlan: null };
}
