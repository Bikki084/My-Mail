import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidEncryptionKeyConfigured } from "@/lib/crypto/smtp-secret";

/** Returns how many SMTP rows exist for this user (service or user client). */
export async function countUserSmtpServers(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("smtp_servers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) {
    throw new Error(`Could not read SMTP servers: ${error.message}`);
  }
  return count ?? 0;
}

export type SendPreflightResult =
  | { ok: true; smtpCount: number }
  | { ok: false; error: string; status: number };

/**
 * Block sends early with a clear message instead of failing silently in the
 * background (0 sent / 0 failed).
 */
export async function runSendPreflight(
  supabase: SupabaseClient,
  userId: string,
): Promise<SendPreflightResult> {
  if (!isValidEncryptionKeyConfigured()) {
    return {
      ok: false,
      status: 503,
      error:
        "SMTP_ENCRYPTION_KEY is missing on the server. Add a 32-byte key to .env.local on the VPS, then run: npm run build && pm2 restart all",
    };
  }

  let smtpCount = 0;
  try {
    smtpCount = await countUserSmtpServers(supabase, userId);
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (smtpCount < 1) {
    return {
      ok: false,
      status: 400,
      error:
        "No SMTP servers saved for your account. Open SMTP Configuration, upload your CSV, click Import valid SMTP servers, confirm they appear under Saved SMTP servers, then send again.",
    };
  }

  return { ok: true, smtpCount };
}
