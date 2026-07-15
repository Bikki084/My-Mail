"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { parseStrict, usageReportQuerySchema } from "@/lib/validation";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type UsageReportRow = {
  userId: string;
  userName: string;
  userEmail: string;
  userLabel: string;
  emailsSent: number;
  creditsUsed: number;
  lastActivityAt: string | null;
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

function profileLabel(p: { full_name: string | null; email: string }): string {
  const name = p.full_name?.trim();
  if (name) return `${name} — ${p.email}`;
  return p.email || "Unknown User";
}

/**
 * Aggregated per-client usage: total emails sent (from sending_logs) and
 * total email credits consumed (from credit_transactions.deducted/email).
 * Optional inclusive date range (YYYY-MM-DD) bounds both aggregates.
 */
export async function listUsageReports(params?: {
  from?: string;
  to?: string;
}): Promise<ActionResult<UsageReportRow[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const parsed = parseStrict(usageReportQuerySchema, params ?? {});
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createServerSupabase();

  const fromIso = parsed.data.from ? `${parsed.data.from}T00:00:00.000Z` : null;
  const toIso = parsed.data.to ? `${parsed.data.to}T23:59:59.000Z` : null;

  const { data: clientProfiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("role", "client")
    .order("created_at", { ascending: false });
  if (profileErr) return { ok: false, error: profileErr.message };

  const profiles = clientProfiles ?? [];
  if (profiles.length === 0) return { ok: true, data: [] };

  const clientIds = profiles.map((p) => p.id);

  let logsQuery = supabase
    .from("sending_logs")
    .select("user_id, status, sent_at")
    .in("user_id", clientIds)
    .eq("status", "sent");
  if (fromIso) logsQuery = logsQuery.gte("sent_at", fromIso);
  if (toIso) logsQuery = logsQuery.lte("sent_at", toIso);

  const { data: logs, error: logsErr } = await logsQuery;
  if (logsErr) return { ok: false, error: logsErr.message };

  let txQuery = supabase
    .from("credit_transactions")
    .select("user_id, amount, type, credit_type, created_at")
    .in("user_id", clientIds)
    .eq("type", "deducted")
    .eq("credit_type", "email");
  if (fromIso) txQuery = txQuery.gte("created_at", fromIso);
  if (toIso) txQuery = txQuery.lte("created_at", toIso);

  const { data: txs, error: txErr } = await txQuery;
  if (txErr) return { ok: false, error: txErr.message };

  const emailCounts = new Map<string, number>();
  const lastActivity = new Map<string, string>();
  for (const row of logs ?? []) {
    emailCounts.set(row.user_id, (emailCounts.get(row.user_id) ?? 0) + 1);
    const prev = lastActivity.get(row.user_id);
    if (!prev || (row.sent_at && row.sent_at > prev)) {
      if (row.sent_at) lastActivity.set(row.user_id, row.sent_at);
    }
  }

  const creditTotals = new Map<string, number>();
  for (const row of txs ?? []) {
    const amt = Number(row.amount) || 0;
    creditTotals.set(row.user_id, (creditTotals.get(row.user_id) ?? 0) + amt);
  }

  const rows: UsageReportRow[] = profiles.map((p) => ({
    userId: p.id,
    userName: p.full_name?.trim() || "",
    userEmail: p.email,
    userLabel: profileLabel(p),
    emailsSent: emailCounts.get(p.id) ?? 0,
    creditsUsed: creditTotals.get(p.id) ?? 0,
    lastActivityAt: lastActivity.get(p.id) ?? null,
  }));

  rows.sort((a, b) => {
    if (b.emailsSent !== a.emailsSent) return b.emailsSent - a.emailsSent;
    return a.userLabel.localeCompare(b.userLabel);
  });

  return { ok: true, data: rows };
}
