import { createClient } from "@supabase/supabase-js";
import { supabaseProjectUrl } from "@/lib/supabase/project-url";

/**
 * Sends Supabase's built-in password recovery email (Auth → Email templates).
 * Uses the **anon** key so behaviour matches the browser recover flow. Mail is
 * delivered via whatever SMTP is configured in the Supabase project (including
 * Supabase's default provider), not via ADMIN_RESET_SMTP_* in this app.
 */
export async function sendAdminRecoveryViaSupabaseAuth(
  adminEmail: string,
  redirectTo: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = supabaseProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return { ok: false, message: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY" };
  }

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.resetPasswordForEmail(adminEmail, {
    redirectTo,
  });

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
