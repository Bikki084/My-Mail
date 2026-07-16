"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { invalidateAdminStatsCache } from "@/lib/cache/invalidate";
import { parseStrict, createClientUserSchema, updateClientUserEmailSchema } from "@/lib/validation";

export type CreateClientUserInput = {
  organizationName: string;
  email: string;
  password: string;
};

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

export async function createClientUser(
  input: CreateClientUserInput,
): Promise<ActionResult<{ userId: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const parsed = parseStrict(createClientUserSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { organizationName, email, password } = parsed.data;

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local.",
    };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: "client",
      full_name: organizationName,
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { ok: false, error: "A user with this email already exists." };
    }
    return { ok: false, error: error.message };
  }

  const userId = data.user?.id;
  if (!userId) return { ok: false, error: "Supabase did not return a user id." };

  // The handle_new_user trigger inserts a profiles row; backstop in case trigger
  // didn't fire or full_name needs to be reflected.
  await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        full_name: organizationName,
        role: "client",
        status: "active",
      },
      { onConflict: "id" },
    );

  await admin
    .from("credits")
    .upsert({ user_id: userId }, { onConflict: "user_id" });

  revalidatePath("/admin/users");
  revalidatePath("/admin/credits/top-up");
  invalidateAdminStatsCache();
  return { ok: true, data: { userId } };
}

export type AdminClientUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  status: "active" | "suspended" | "blocked";
  created_at: string;
};

export async function listClientUsers(): Promise<ActionResult<AdminClientUserRow[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, status, created_at")
    .eq("role", "client")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as AdminClientUserRow[] };
}

export type UpdateClientUserEmailInput = {
  userId: string;
  email: string;
};

/**
 * Updates a client user's email in both Supabase Auth (via the admin API) and
 * the mirrored `profiles.email` column. `email_confirm: true` skips the
 * confirmation round-trip so the new address is immediately usable for the
 * "send test email to myself" flow on the client console.
 */
export async function updateClientUserEmail(
  input: UpdateClientUserEmailInput,
): Promise<ActionResult<AdminClientUserRow>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const parsed = parseStrict(updateClientUserEmailSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { userId, email } = parsed.data;

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return {
      ok: false,
      error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local.",
    };
  }

  // Make sure we only edit client users, not other admins.
  const { data: target, error: targetErr } = await admin
    .from("profiles")
    .select("id, role, email")
    .eq("id", userId)
    .maybeSingle();
  if (targetErr) return { ok: false, error: targetErr.message };
  if (!target) return { ok: false, error: "User not found." };
  if (target.role !== "client") {
    return { ok: false, error: "Only client users can be edited here." };
  }

  // Reject duplicates against another existing profile.
  if (email !== (target.email ?? "").toLowerCase()) {
    const { data: dup } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .neq("id", userId)
      .maybeSingle();
    if (dup) {
      return { ok: false, error: "Another user already has that email." };
    }
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (authErr) {
    const msg = authErr.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { ok: false, error: "A user with this email already exists." };
    }
    return { ok: false, error: authErr.message };
  }

  // Mirror into profiles — the trigger won't fire for email changes post-signup.
  const { data: profileRow, error: profileErr } = await admin
    .from("profiles")
    .update({ email })
    .eq("id", userId)
    .select("id, email, full_name, status, created_at")
    .single();
  if (profileErr) return { ok: false, error: profileErr.message };

  revalidatePath("/admin/users");
  revalidatePath("/admin/credits/top-up");
  invalidateAdminStatsCache();
  return { ok: true, data: profileRow as AdminClientUserRow };
}

/** Client-role profiles with `status = active` (e.g. credit assignment dropdown). */
export async function listActiveClientUsers(): Promise<ActionResult<AdminClientUserRow[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, status, created_at")
    .eq("role", "client")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as AdminClientUserRow[] };
}
