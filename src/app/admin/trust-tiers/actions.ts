"use server";

import { createClient } from "@/lib/supabase/server";
import { listTrustTierClientsForAdmin } from "@/lib/trust-tier/service";
import type { TrustTier } from "@/lib/trust-tier/types";

export type AdminTrustTierRow = {
  userId: string;
  email: string;
  fullName: string | null;
  tier: TrustTier;
  dailyLimit: number;
  sentToday: number;
  remainingToday: number;
};

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Forbidden");
  return supabase;
}

export async function fetchAdminTrustTierRows(): Promise<AdminTrustTierRow[]> {
  const supabase = await requireAdmin();
  return listTrustTierClientsForAdmin(supabase);
}
