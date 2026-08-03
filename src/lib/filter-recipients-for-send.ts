import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecipientRow } from "@/lib/merge-tags";
import {
  formatBlockedReasons,
  validateRecipients,
  validationResultMap,
} from "@/lib/recipient-validation";
import { addSuppression, type SuppressionSource } from "@/lib/recipient-suppression";

export type FilterRecipientsResult = {
  safe: RecipientRow[];
  blocked: { email: string; reasons: string }[];
  warnings: string[];
};

/**
 * Server-side gate before storing or sending recipients. Drops any address
 * with bounce risk (syntax, disposable, no MX, suppression, role addresses).
 */
export async function filterRecipientsForSend(
  supabase: SupabaseClient,
  userId: string,
  recipients: RecipientRow[],
): Promise<FilterRecipientsResult> {
  const emails = recipients.map((r) => r.email);
  const summary = await validateRecipients(supabase, userId, emails);
  const byEmail = validationResultMap(summary);

  const safe: RecipientRow[] = [];
  const blocked: { email: string; reasons: string }[] = [];

  for (const r of recipients) {
    const key = r.email.trim().toLowerCase();
    const v = byEmail.get(key);
    if (v && !v.ok) {
      blocked.push({
        email: key,
        reasons: formatBlockedReasons(v.reasons),
      });
      continue;
    }
    safe.push({ ...r, email: key });
  }

  const warnings: string[] = [];
  if (blocked.length > 0) {
    warnings.push(
      `${blocked.length} recipient(s) blocked before send (invalid, disposable, no MX, suppressed, or role address).`,
    );
  }

  return { safe, blocked, warnings };
}

/** Persist validation blocks so future uploads skip them immediately. */
export async function persistValidationBlocks(
  supabase: SupabaseClient,
  userId: string,
  blocked: { email: string; reasons: string }[],
  campaignId?: string | null,
): Promise<void> {
  for (const row of blocked) {
    await addSuppression(supabase, {
      userId,
      recipientEmail: row.email,
      source: "validation" satisfies SuppressionSource,
      campaignId: campaignId ?? null,
      note: row.reasons.slice(0, 500),
    });
  }
}
