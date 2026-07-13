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

export type UserEmailsTodayRow = {
  userId: string;
  displayName: string;
  email: string;
  emailsSent: number;
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

export async function getPerUserEmailsToday(): Promise<{
  rows: UserEmailsTodayRow[];
  live: boolean;
}> {
  if (!isSupabaseAuthConfigured()) {
    return { rows: [], live: false };
  }

  const supabase = await createServerSupabase();
  const todayIso = startOfTodayIso();

  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("role", "client")
    .order("created_at", { ascending: true });

  if (profileErr || !profiles?.length) {
    return { rows: [], live: !profileErr };
  }

  const clientIds = profiles.map((p) => p.id);
  const { data: logs, error: logsErr } = await supabase
    .from("sending_logs")
    .select("user_id")
    .in("user_id", clientIds)
    .eq("status", "sent")
    .gte("sent_at", todayIso);

  if (logsErr) {
    return { rows: [], live: false };
  }

  const counts = new Map<string, number>();
  for (const row of logs ?? []) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }

  const rows: UserEmailsTodayRow[] = profiles
    .map((p) => ({
      userId: p.id,
      displayName: p.full_name?.trim() || p.email,
      email: p.email,
      emailsSent: counts.get(p.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.emailsSent !== a.emailsSent) return b.emailsSent - a.emailsSent;
      return a.displayName.localeCompare(b.displayName);
    });

  return { rows, live: true };
}
