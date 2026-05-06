"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/auth-config";

export type AdminDashboardStats = {
  clientAccounts: number;
  activeCampaigns: number;
  emailsSentToday: number;
  creditsIssuedMonth: number;
  /** true when values are live from Supabase; false when Supabase is not configured */
  live: boolean;
};

const EMPTY_STATS: AdminDashboardStats = {
  clientAccounts: 0,
  activeCampaigns: 0,
  emailsSentToday: 0,
  creditsIssuedMonth: 0,
  live: false,
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthIso(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getDashboardStats(): Promise<AdminDashboardStats> {
  if (!isSupabaseAuthConfigured()) {
    return EMPTY_STATS;
  }

  const supabase = await createServerSupabase();

  const [clients, campaigns, emailsToday, creditTx] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "client"),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .in("status", ["sending", "queued", "paused"]),
    supabase
      .from("sending_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", startOfTodayIso()),
    supabase
      .from("credit_transactions")
      .select("amount")
      .eq("type", "assigned")
      .gte("created_at", startOfMonthIso()),
  ]);

  const creditsIssuedMonth = (creditTx.data ?? []).reduce<number>(
    (sum, row) => sum + (typeof row.amount === "number" ? row.amount : 0),
    0,
  );

  return {
    clientAccounts: clients.count ?? 0,
    activeCampaigns: campaigns.count ?? 0,
    emailsSentToday: emailsToday.count ?? 0,
    creditsIssuedMonth,
    live: true,
  };
}
