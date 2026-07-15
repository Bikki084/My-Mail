"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { parseStrict, walletTopUpSchema } from "@/lib/validation";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_TOPUP = 10_000_000;

const MIGRATION_HINT =
  "Wallet schema not found in Supabase. Run supabase/migrations/20260428120000_wallet_and_plans.sql in the Supabase SQL Editor.";

// Postgres error codes used to detect a missing wallet schema (i.e. the
// migration hasn't been applied yet) so we can show a clear actionable
// message instead of the raw "column credits.wallet_balance does not exist".
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

async function assertAdmin(): Promise<
  | { ok: true; adminId: string }
  | { ok: false; error: string }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (profile?.role !== "admin") return { ok: false, error: "Admin role required." };
  return { ok: true, adminId: user.id };
}

/**
 * Returns the current wallet balance for a client user.
 *
 * Used by the admin Top-up Credits page to show the existing balance before
 * applying a top-up. RLS allows admins to read all `credits` rows.
 */
export async function getWalletBalanceFor(
  userId: string,
): Promise<ActionResult<{ balance: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!userId || !UUID_RE.test(userId)) {
    return { ok: false, error: "Select a valid user." };
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local.",
    };
  }

  const { data, error } = await admin
    .from("credits")
    .select("wallet_balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (isMissingWalletSchema(error)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: { balance: Math.max(0, Math.floor(Number(data?.wallet_balance ?? 0))) },
  };
}

/**
 * Adds `amount` credits to the target client user's wallet.
 *
 *  - Increments `credits.wallet_balance` (creates the row if missing).
 *  - Inserts a `wallet_transactions` audit row with kind='topup'.
 *  - Revalidates the client dashboard so the new balance appears on next load.
 */
export async function topUpWallet(input: {
  userId: string;
  amount: number;
  note?: string;
}): Promise<ActionResult<{ balance: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const parsed = parseStrict(walletTopUpSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { userId, amount, note } = parsed.data;

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local.",
    };
  }

  // Confirm target user exists and is a client.
  const { data: targetProfile, error: targetErr } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return { ok: false, error: targetErr.message };
  if (!targetProfile) return { ok: false, error: "User not found." };
  if (targetProfile.role !== "client") {
    return { ok: false, error: "Top-ups can only be applied to client users." };
  }

  // Read current balance, then write balance + amount. Doing this client-side
  // is fine for an admin tool with a single concurrent operator; if we ever
  // expose this to multiple admins simultaneously, swap to a Postgres RPC.
  const { data: existing, error: readErr } = await admin
    .from("credits")
    .select("wallet_balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) {
    if (isMissingWalletSchema(readErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: readErr.message };
  }

  const currentBalance = Math.max(
    0,
    Math.floor(Number(existing?.wallet_balance ?? 0)),
  );
  const newBalance = currentBalance + amount;

  const { error: upsertErr } = await admin.from("credits").upsert(
    {
      user_id: userId,
      wallet_balance: newBalance,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertErr) {
    if (isMissingWalletSchema(upsertErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: upsertErr.message };
  }

  const { error: txErr } = await admin.from("wallet_transactions").insert({
    user_id: userId,
    admin_id: guard.adminId,
    kind: "topup",
    amount,
    plan_id: null,
    note: note ?? null,
  });
  if (txErr) {
    if (isMissingWalletSchema(txErr)) return { ok: false, error: MIGRATION_HINT };
    return { ok: false, error: txErr.message };
  }

  revalidatePath("/admin/credits/top-up");
  revalidatePath("/admin/reports");
  revalidatePath("/client");
  revalidatePath("/client/overview");

  return { ok: true, data: { balance: newBalance } };
}
