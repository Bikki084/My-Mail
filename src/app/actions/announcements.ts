"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { parseStrict, announcementReadIdsSchema } from "@/lib/validation";

export type AnnouncementItem = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

export type AnnouncementsForClientResult =
  | {
      ok: true;
      unread: AnnouncementItem[];
      all: AnnouncementItem[];
      /** True when read-tracking isn't available (e.g. table not migrated yet). */
      readTrackingDisabled?: boolean;
    }
  | { ok: false; error: string };

/**
 * Detects "table does not exist" responses across the three flavours Supabase
 * / PostgREST can return them in: raw Postgres 42P01, PostgREST schema-cache
 * miss (PGRST205 — "Could not find the table … in the schema cache"), and a
 * generic "does not exist" message as a last-resort substring check.
 */
const UNDEFINED_TABLE_CODE = "42P01";
const POSTGREST_SCHEMA_CACHE_CODE = "PGRST205";

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === UNDEFINED_TABLE_CODE) return true;
  if (err.code === POSTGREST_SCHEMA_CACHE_CODE) return true;
  const msg = err.message?.toLowerCase() ?? "";
  if (!msg.includes("announcement_reads")) return false;
  return msg.includes("does not exist") || msg.includes("could not find");
}

/**
 * Returns every announcement (newest first) for the current client plus the
 * subset that hasn't been acknowledged yet (used to drive the bell red-dot).
 *
 * Degrades gracefully when the `announcement_reads` table isn't present yet:
 * we treat every announcement as unread so the popup still surfaces.
 */
export async function listAnnouncementsForClient(): Promise<AnnouncementsForClientResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: ann, error } = await supabase
    .from("announcements")
    .select("id, title, body, created_at")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };

  const all = (ann ?? []) as AnnouncementItem[];
  if (all.length === 0) return { ok: true, unread: [], all: [] };

  const { data: reads, error: rErr } = await supabase
    .from("announcement_reads")
    .select("announcement_id")
    .eq("user_id", user.id);

  if (rErr) {
    if (isMissingTable(rErr)) {
      return { ok: true, unread: all, all, readTrackingDisabled: true };
    }
    return { ok: false, error: rErr.message };
  }

  const readSet = new Set((reads ?? []).map((r) => r.announcement_id as string));
  const unread = all.filter((a) => !readSet.has(a.id));

  return { ok: true, unread, all };
}

export async function markAnnouncementsRead(
  ids: string[],
): Promise<{ ok: true; persisted: boolean } | { ok: false; error: string }> {
  const parsed = parseStrict(announcementReadIdsSchema, { ids });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.data.ids.length === 0) return { ok: true, persisted: false };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  // Use the service-role client so RLS can't block the insert; we've already
  // authenticated the caller and are only ever writing rows for their own id.
  let service;
  try {
    service = createServiceClient();
  } catch {
    // No service key — fall back to the user-scoped client.
    service = supabase;
  }

  const rows = parsed.data.ids.map((id) => ({ announcement_id: id, user_id: user.id }));
  const { error } = await service
    .from("announcement_reads")
    .upsert(rows, {
      onConflict: "announcement_id,user_id",
      ignoreDuplicates: true,
    });

  if (error) {
    if (isMissingTable(error)) {
      // Table not migrated yet — treat the click as a soft-dismiss so the UI
      // doesn't show an error. State is session-only until the migration runs.
      return { ok: true, persisted: false };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, persisted: true };
}
