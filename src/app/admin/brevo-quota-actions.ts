"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { fetchBrevoQuota, type BrevoQuotaSnapshot } from "@/lib/brevo/account";

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
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

  if (profile?.role !== "admin") {
    return { ok: false, error: "Admin only." };
  }
  return { ok: true };
}

export async function refreshBrevoQuota(force = true): Promise<BrevoQuotaSnapshot> {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return {
      configured: false,
      live: false,
      error: guard.error,
      fetchedAt: new Date().toISOString(),
    };
  }
  return fetchBrevoQuota({ force });
}

export async function getBrevoQuotaForAdmin(): Promise<BrevoQuotaSnapshot> {
  return refreshBrevoQuota(false);
}
