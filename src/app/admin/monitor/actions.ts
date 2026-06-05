"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type MonitorCampaignRow = {
  id: string;
  name: string;
  client: string;
  clientEmail: string;
  status: string;
  emailsSent: number;
  totalEmails: number;
  failedCount: number;
  date: string;
  updatedAt: string;
  lastError: string | null;
};

async function assertAdmin(): Promise<ActionResult> {
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
  return { ok: true };
}

function clientLabel(p: { full_name: string | null; email: string } | null): {
  client: string;
  clientEmail: string;
} {
  const email = p?.email?.trim() || "";
  const name = p?.full_name?.trim() || "";
  if (name && email) return { client: name, clientEmail: email };
  if (name) return { client: name, clientEmail: email };
  return { client: email || "Unknown client", clientEmail: email };
}

function campaignName(streamName: string | null, subject: string | null): string {
  const stream = streamName?.trim();
  if (stream) return stream;
  const subj = subject?.trim();
  if (subj) return subj;
  return "(Untitled campaign)";
}

type CampaignDbRow = {
  id: string;
  stream_name: string | null;
  subject: string | null;
  status: string;
  sent_count: number | null;
  failed_count: number | null;
  total_emails: number | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
};

/** Live + historical campaigns for all clients (admin). */
export async function listMonitorCampaigns(params?: {
  limit?: number;
}): Promise<ActionResult<MonitorCampaignRow[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const limit = Math.min(Math.max(params?.limit ?? 200, 1), 500);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("campaigns")
    .select(
      "id, stream_name, subject, status, sent_count, failed_count, total_emails, created_at, updated_at, last_error, profiles(full_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message };

  const rows: MonitorCampaignRow[] = ((data ?? []) as CampaignDbRow[]).map((c) => {
    const profile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    const { client, clientEmail } = clientLabel(profile);
    return {
      id: c.id,
      name: campaignName(c.stream_name, c.subject),
      client,
      clientEmail,
      status: c.status,
      emailsSent: c.sent_count ?? 0,
      totalEmails: c.total_emails ?? 0,
      failedCount: c.failed_count ?? 0,
      date: c.created_at,
      updatedAt: c.updated_at,
      lastError: c.last_error,
    };
  });

  return { ok: true, data: rows };
}
