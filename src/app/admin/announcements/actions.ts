"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<ActionResult<{ userId: string }>> {
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
  return { ok: true, data: { userId: user.id } };
}

function getServiceClient(): { ok: true; client: ReturnType<typeof createServiceClient> } | { ok: false; error: string } {
  try {
    return { ok: true, client: createServiceClient() };
  } catch {
    return {
      ok: false,
      error:
        "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (Supabase → Settings → API → service_role).",
    };
  }
}

export type AdminAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

const TITLE_MAX = 160;
const BODY_MAX = 4000;

export async function createAnnouncement(input: {
  title: string;
  body: string;
}): Promise<ActionResult<{ id: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const title = input.title.trim();
  const body = input.body.trim();

  if (!title) return { ok: false, error: "Title is required." };
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `Title must be ${TITLE_MAX} characters or fewer.` };
  }
  if (!body) return { ok: false, error: "Message is required." };
  if (body.length > BODY_MAX) {
    return { ok: false, error: `Message must be ${BODY_MAX} characters or fewer.` };
  }

  const svc = getServiceClient();
  if (!svc.ok) return svc;

  const { data, error } = await svc.client
    .from("announcements")
    .insert({ title, body, created_by: guard.data!.userId })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/announcements");
  revalidatePath("/client");
  return { ok: true, data: { id: data.id } };
}

export async function listAnnouncements(): Promise<ActionResult<AdminAnnouncementRow[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, created_at")
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as AdminAnnouncementRow[] };
}

export async function deleteAnnouncement(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!id) return { ok: false, error: "Announcement id is required." };

  const svc = getServiceClient();
  if (!svc.ok) return svc;

  const { error } = await svc.client.from("announcements").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/announcements");
  revalidatePath("/client");
  return { ok: true };
}
