"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

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

export type LoginHistoryRow = {
  id: string;
  userId: string;
  userLabel: string;
  loginAt: string;
  logoutAt: string | null;
  ipAddress: string | null;
};

export type LoginHistoryUser = { id: string; label: string };

export type ListLoginHistoryParams = {
  userId?: string;
  /** ISO date (YYYY-MM-DD), inclusive lower bound on login_at */
  from?: string;
  /** ISO date (YYYY-MM-DD), inclusive upper bound on login_at */
  to?: string;
  page?: number;
  pageSize?: number;
};

export type ListLoginHistoryResult = {
  rows: LoginHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  users: LoginHistoryUser[];
};

type EventRow = {
  id: string;
  user_id: string;
  event_type: "login" | "logout";
  ip_address: string | null;
  created_at: string;
};

function profileLabel(p: { full_name: string | null; email: string } | undefined): string {
  if (!p) return "Unknown User";
  const name = p.full_name?.trim();
  if (name) return `${name} — ${p.email}`;
  return p.email || "Unknown User";
}

/**
 * Pair each `login` event with the next `logout` event from the same user,
 * walking events in chronological order per user.
 */
function pairSessions(events: EventRow[]): Array<{
  id: string;
  userId: string;
  loginAt: string;
  logoutAt: string | null;
  ipAddress: string | null;
}> {
  const byUser = new Map<string, EventRow[]>();
  for (const ev of events) {
    const list = byUser.get(ev.user_id) ?? [];
    list.push(ev);
    byUser.set(ev.user_id, list);
  }

  const sessions: Array<{
    id: string;
    userId: string;
    loginAt: string;
    logoutAt: string | null;
    ipAddress: string | null;
  }> = [];

  for (const [userId, evs] of byUser.entries()) {
    evs.sort((a, b) => a.created_at.localeCompare(b.created_at));

    let pending: EventRow | null = null;
    for (const ev of evs) {
      if (ev.event_type === "login") {
        if (pending) {
          sessions.push({
            id: pending.id,
            userId,
            loginAt: pending.created_at,
            logoutAt: null,
            ipAddress: pending.ip_address,
          });
        }
        pending = ev;
      } else if (pending) {
        sessions.push({
          id: pending.id,
          userId,
          loginAt: pending.created_at,
          logoutAt: ev.created_at,
          ipAddress: pending.ip_address,
        });
        pending = null;
      }
    }
    if (pending) {
      sessions.push({
        id: pending.id,
        userId,
        loginAt: pending.created_at,
        logoutAt: null,
        ipAddress: pending.ip_address,
      });
    }
  }

  sessions.sort((a, b) => b.loginAt.localeCompare(a.loginAt));
  return sessions;
}

export async function listLoginHistory(
  params: ListLoginHistoryParams = {},
): Promise<ActionResult<ListLoginHistoryResult>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(5, Math.floor(params.pageSize ?? 25)));

  const supabase = await createServerSupabase();

  let query = supabase
    .from("login_events")
    .select("id, user_id, event_type, ip_address, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (params.userId) query = query.eq("user_id", params.userId);
  if (params.from) query = query.gte("created_at", `${params.from}T00:00:00Z`);
  if (params.to) query = query.lte("created_at", `${params.to}T23:59:59Z`);

  const { data: events, error } = await query;
  if (error) return { ok: false, error: error.message };

  const sessions = pairSessions((events ?? []) as EventRow[]);

  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const byId = new Map<string, { full_name: string | null; email: string }>();

  if (userIds.length > 0) {
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    if (pErr) return { ok: false, error: pErr.message };
    for (const p of profs ?? []) {
      byId.set(p.id, { full_name: p.full_name, email: p.email });
    }
  }

  const rows: LoginHistoryRow[] = sessions.map((s) => ({
    id: s.id,
    userId: s.userId,
    userLabel: profileLabel(byId.get(s.userId)),
    loginAt: s.loginAt,
    logoutAt: s.logoutAt,
    ipAddress: s.ipAddress,
  }));

  const { data: allProfiles, error: uErr } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name", { ascending: true });
  if (uErr) return { ok: false, error: uErr.message };

  const users: LoginHistoryUser[] = (allProfiles ?? []).map((p) => ({
    id: p.id,
    label: profileLabel({ full_name: p.full_name, email: p.email }),
  }));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize);

  return {
    ok: true,
    data: {
      rows: paged,
      total,
      page,
      pageSize,
      users,
    },
  };
}
