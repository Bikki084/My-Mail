import type { SupabaseClient } from "@supabase/supabase-js";

export type SuppressionSource =
  | "one_click"
  | "mailto"
  | "manual"
  | "complaint"
  | "hard_bounce"
  | "soft_bounce"
  | "blocked"
  | "spam_report"
  | "validation";

export type AddSuppressionParams = {
  userId: string | null;
  recipientEmail: string;
  source: SuppressionSource;
  campaignId?: string | null;
  note?: string | null;
};

/** Hard bounces, blocks, spam, and validation blocks — never send again for this tenant. */
export const AUTO_SUPPRESS_SOURCES: SuppressionSource[] = [
  "hard_bounce",
  "blocked",
  "spam_report",
  "complaint",
  "validation",
];

export function isHardSuppressSource(source: SuppressionSource): boolean {
  return AUTO_SUPPRESS_SOURCES.includes(source);
}

/**
 * Load all suppressed emails for a sender (unsubscribes + bounces + validation blocks).
 */
export async function loadSuppressedEmails(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const suppressed = new Set<string>();
  try {
    const { data: rows, error } = await supabase
      .from("unsubscribes")
      .select("recipient_email")
      .eq("user_id", userId);
    if (!error && Array.isArray(rows)) {
      for (const r of rows as { recipient_email: string }[]) {
        if (r.recipient_email) suppressed.add(r.recipient_email.trim().toLowerCase());
      }
    } else if (
      error &&
      (error as { code?: string }).code &&
      (error as { code?: string }).code !== "42P01"
    ) {
      console.warn(
        `[recipient-suppression] could not load list for user=${userId}: ${error.message}`,
      );
    }
  } catch (e) {
    console.warn(
      `[recipient-suppression] load threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return suppressed;
}

/**
 * Record a suppression (idempotent). Uses service role when RLS blocks inserts.
 */
export async function addSuppression(
  supabase: SupabaseClient,
  params: AddSuppressionParams,
): Promise<{ ok: boolean; reason?: string }> {
  const email = params.recipientEmail.trim().toLowerCase();
  if (!email) return { ok: false, reason: "empty_email" };

  const ins = await supabase.from("unsubscribes").insert({
    user_id: params.userId,
    recipient_email: email,
    campaign_id: params.campaignId ?? null,
    source: params.source,
    note: params.note ? params.note.slice(0, 500) : null,
  });

  if (ins.error) {
    if ((ins.error as { code?: string }).code === "23505") {
      return { ok: true };
    }
    if ((ins.error as { code?: string }).code === "42P01") {
      return { ok: false, reason: "table_missing" };
    }
    return { ok: false, reason: ins.error.message };
  }
  return { ok: true };
}

export function suppressionSkipMessage(source?: SuppressionSource | string | null): string {
  switch (source) {
    case "hard_bounce":
      return "Hard bounce — recipient suppressed (skipped).";
    case "soft_bounce":
      return "Soft bounce — recipient suppressed (skipped).";
    case "blocked":
      return "Blocked by provider — recipient suppressed (skipped).";
    case "spam_report":
      return "Spam complaint — recipient suppressed (skipped).";
    case "validation":
      return "Failed deliverability validation (skipped).";
    case "complaint":
      return "Complaint — recipient suppressed (skipped).";
    case "one_click":
    case "mailto":
    case "manual":
      return "Recipient previously unsubscribed (skipped).";
    default:
      return "Recipient suppressed (skipped).";
  }
}
