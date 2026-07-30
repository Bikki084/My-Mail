/**
 * Capture a completed (or partially sent) campaign into the admin user-activity
 * tables. Idempotent — skips if the batch row already exists.
 * Retention: expires_at = sent_at + 2 days (purged by scripts/purge-user-activity.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecipientRow } from "@/lib/merge-tags";

const RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const RECIPIENT_INSERT_CHUNK = 500;

type SendingLogRow = {
  recipient_email: string;
  status: string;
  sent_at: string;
};

type CampaignCaptureRow = {
  id: string;
  user_id: string;
  stream_name: string | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  sender_name: string | null;
  attachment_paths: unknown;
  html_attachment: unknown;
  recipients: unknown;
  total_emails: number | null;
  sent_count: number | null;
  failed_count: number | null;
  updated_at: string | null;
};

function parseRecipients(raw: unknown): RecipientRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is RecipientRow =>
      r != null &&
      typeof r === "object" &&
      typeof (r as RecipientRow).email === "string" &&
      (r as RecipientRow).email.trim().length > 0,
  );
}

function pickSampleRecipient(
  logs: SendingLogRow[],
  recipients: RecipientRow[],
): RecipientRow {
  const sentLogs = logs.filter((l) => l.status === "sent");
  const pool = sentLogs.length > 0 ? sentLogs : logs;
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? pool[0];
  if (!pick) {
    return recipients[0] ?? { email: "unknown@example.com" };
  }
  const email = pick.recipient_email.trim().toLowerCase();
  const match = recipients.find((r) => r.email.trim().toLowerCase() === email);
  if (match) return match;
  return { email: pick.recipient_email };
}

function latestSentAt(logs: SendingLogRow[], fallbackIso: string): string {
  let max = 0;
  for (const l of logs) {
    const t = new Date(l.sent_at).getTime();
    if (!Number.isNaN(t) && t > max) max = t;
  }
  if (max > 0) return new Date(max).toISOString();
  return fallbackIso;
}

export async function captureUserActivityBatch(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("user_activity_batches")
    .select("campaign_id")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (existing) return;

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select(
      "id, user_id, stream_name, subject, body_html, body_text, sender_name, attachment_paths, html_attachment, recipients, total_emails, sent_count, failed_count, updated_at",
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (campErr || !campaign) {
    console.warn(
      `[user-activity] skip capture campaign=${campaignId}: ${campErr?.message ?? "not found"}`,
    );
    return;
  }
  const c = campaign as CampaignCaptureRow;

  const { data: logsRaw, error: logsErr } = await supabase
    .from("sending_logs")
    .select("recipient_email, status, sent_at")
    .eq("campaign_id", campaignId)
    .order("sent_at", { ascending: true });
  if (logsErr) {
    console.warn(
      `[user-activity] skip capture campaign=${campaignId}: logs ${logsErr.message}`,
    );
    return;
  }
  const logs = (logsRaw ?? []) as SendingLogRow[];
  if (logs.length === 0) return;

  const recipients = parseRecipients(c.recipients);
  const fallbackIso = c.updated_at ?? new Date().toISOString();
  const sentAt = latestSentAt(logs, fallbackIso);
  const expiresAt = new Date(new Date(sentAt).getTime() + RETENTION_MS).toISOString();
  const sampleRecipient = pickSampleRecipient(logs, recipients);

  const sentCount =
    typeof c.sent_count === "number"
      ? c.sent_count
      : logs.filter((l) => l.status === "sent").length;
  const failedCount =
    typeof c.failed_count === "number"
      ? c.failed_count
      : logs.filter((l) => l.status === "failed" || l.status === "bounced").length;
  const recipientCount =
    typeof c.total_emails === "number" && c.total_emails > 0
      ? c.total_emails
      : logs.length;

  const { error: batchErr } = await supabase.from("user_activity_batches").insert({
    campaign_id: campaignId,
    user_id: c.user_id,
    stream_name: c.stream_name,
    subject: c.subject,
    recipient_count: recipientCount,
    sent_count: sentCount,
    failed_count: failedCount,
    sent_at: sentAt,
    expires_at: expiresAt,
  });
  if (batchErr) {
    if (batchErr.message.includes("duplicate") || batchErr.code === "23505") return;
    console.error(
      `[user-activity] batch insert failed campaign=${campaignId}: ${batchErr.message}`,
    );
    return;
  }

  const { error: snapErr } = await supabase.from("user_activity_snapshots").insert({
    campaign_id: campaignId,
    subject: c.subject,
    body_html: c.body_html,
    body_text: c.body_text,
    sender_name: c.sender_name,
    attachments: c.attachment_paths ?? [],
    html_attachment: c.html_attachment ?? null,
    sample_recipient: sampleRecipient,
  });
  if (snapErr) {
    console.error(
      `[user-activity] snapshot insert failed campaign=${campaignId}: ${snapErr.message}`,
    );
    await supabase.from("user_activity_batches").delete().eq("campaign_id", campaignId);
    return;
  }

  for (let i = 0; i < logs.length; i += RECIPIENT_INSERT_CHUNK) {
    const chunk = logs.slice(i, i + RECIPIENT_INSERT_CHUNK).map((l) => ({
      campaign_id: campaignId,
      recipient_email: l.recipient_email,
      status: l.status,
      sent_at: l.sent_at,
    }));
    const { error: recErr } = await supabase.from("user_activity_recipients").insert(chunk);
    if (recErr) {
      console.error(
        `[user-activity] recipients insert failed campaign=${campaignId}: ${recErr.message}`,
      );
      await supabase.from("user_activity_batches").delete().eq("campaign_id", campaignId);
      return;
    }
  }

  console.log(
    `[user-activity] captured campaign=${campaignId} recipients=${logs.length} expires=${expiresAt}`,
  );
}
