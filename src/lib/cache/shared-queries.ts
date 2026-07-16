import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/auth-config";
import { cachedFragment } from "@/lib/cache/render-cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import type {
  AdminDashboardStats,
  UserEmailsTodayRow,
} from "@/app/admin/actions";
import type { AdminAnnouncementRow } from "@/app/admin/announcements/actions";
import type { AnnouncementItem } from "@/app/actions/announcements";

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

function serviceOrNull() {
  if (!isSupabaseAuthConfigured()) return null;
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

async function fetchAdminDashboardStatsRaw(): Promise<AdminDashboardStats> {
  const supabase = serviceOrNull();
  if (!supabase) return EMPTY_STATS;

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

async function fetchPerUserEmailsTodayRaw(): Promise<{
  rows: UserEmailsTodayRow[];
  live: boolean;
}> {
  const supabase = serviceOrNull();
  if (!supabase) return { rows: [], live: false };

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

  if (logsErr) return { rows: [], live: false };

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

async function fetchAnnouncementsRaw(): Promise<AnnouncementItem[]> {
  const supabase = serviceOrNull();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[cache] announcements fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as AnnouncementItem[];
}

export async function getCachedAdminDashboardStats(
  locale: string,
): Promise<AdminDashboardStats> {
  return cachedFragment(
    ["admin-dashboard-stats", `locale:${locale}`],
    fetchAdminDashboardStatsRaw,
    { revalidate: 45, tags: [CACHE_TAGS.adminStats] },
  )();
}

export async function getCachedPerUserEmailsToday(
  locale: string,
): Promise<{ rows: UserEmailsTodayRow[]; live: boolean }> {
  return cachedFragment(
    ["admin-per-user-emails-today", `locale:${locale}`],
    fetchPerUserEmailsTodayRaw,
    { revalidate: 45, tags: [CACHE_TAGS.adminStats] },
  )();
}

export async function getCachedAnnouncementsList(
  locale: string,
): Promise<AdminAnnouncementRow[]> {
  return cachedFragment(
    ["announcements-list", `locale:${locale}`],
    fetchAnnouncementsRaw,
    { revalidate: 60, tags: [CACHE_TAGS.announcements] },
  )() as Promise<AdminAnnouncementRow[]>;
}

export async function getCachedGlobalAnnouncements(
  locale: string,
): Promise<AnnouncementItem[]> {
  return cachedFragment(
    ["announcements-global", `locale:${locale}`],
    fetchAnnouncementsRaw,
    { revalidate: 60, tags: [CACHE_TAGS.announcements] },
  )();
}
