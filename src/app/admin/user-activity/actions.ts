"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import { sanitizeEmailHtml } from "@/lib/html-email";
import {
  listActivityAttachmentMeta,
  type ActivityAttachmentMeta,
} from "@/lib/user-activity-attachments";

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

export type UserActivitySearchUser = {
  id: string;
  email: string;
  full_name: string | null;
  label: string;
};

export async function searchUsersForActivity(
  query: string,
): Promise<ActionResult<UserActivitySearchUser[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const q = query.trim().toLowerCase();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("role", "client")
    .order("full_name", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? [])
    .map((p) => {
      const email = p.email ?? "";
      const name = p.full_name?.trim() ?? "";
      const label = name && email ? `${name} — ${email}` : name || email || p.id;
      return { id: p.id, email, full_name: p.full_name, label };
    })
    .filter((u) => {
      if (!q) return true;
      return (
        u.label.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.full_name ?? "").toLowerCase().includes(q)
      );
    });

  return { ok: true, data: rows.slice(0, 50) };
}

export type UserActivityBatchRow = {
  campaignId: string;
  streamName: string | null;
  subject: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  sentAt: string;
};

function dayBoundsUtc(dateYmd: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const start = new Date(`${dateYmd}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function listUserActivityBatches(input: {
  userId: string;
  dateYmd: string;
}): Promise<ActionResult<UserActivityBatchRow[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const userId = input.userId.trim();
  if (!userId) return { ok: false, error: "Select a user." };

  const bounds = dayBoundsUtc(input.dateYmd.trim());
  if (!bounds) return { ok: false, error: "Invalid date." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("user_activity_batches")
    .select(
      "campaign_id, stream_name, subject, recipient_count, sent_count, failed_count, sent_at",
    )
    .eq("user_id", userId)
    .gte("sent_at", bounds.start)
    .lt("sent_at", bounds.end)
    .order("sent_at", { ascending: false });
  if (error) return { ok: false, error: error.message };

  const rows: UserActivityBatchRow[] = (data ?? []).map((r) => ({
    campaignId: r.campaign_id,
    streamName: r.stream_name,
    subject: r.subject,
    recipientCount: r.recipient_count ?? 0,
    sentCount: r.sent_count ?? 0,
    failedCount: r.failed_count ?? 0,
    sentAt: r.sent_at,
  }));

  return { ok: true, data: rows };
}

export type UserActivityRecipientRow = {
  id: string;
  recipientEmail: string;
  status: "sent" | "failed" | "bounced";
  sentAt: string;
};

export async function listUserActivityRecipients(
  campaignId: string,
): Promise<ActionResult<UserActivityRecipientRow[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const id = campaignId.trim();
  if (!id) return { ok: false, error: "Batch id required." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("user_activity_recipients")
    .select("id, recipient_email, status, sent_at")
    .eq("campaign_id", id)
    .order("sent_at", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const rows: UserActivityRecipientRow[] = (data ?? []).map((r) => ({
    id: r.id,
    recipientEmail: r.recipient_email,
    status: r.status as UserActivityRecipientRow["status"],
    sentAt: r.sent_at,
  }));

  return { ok: true, data: rows };
}

export type UserActivityAttachmentMeta = ActivityAttachmentMeta;

export type UserActivityMailPreview = {
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  senderName: string | null;
  attachments: UserActivityAttachmentMeta[];
};

export async function getUserActivitySampleMail(
  campaignId: string,
): Promise<ActionResult<UserActivityMailPreview>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const id = campaignId.trim();
  if (!id) return { ok: false, error: "Batch id required." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("user_activity_snapshots")
    .select(
      "subject, body_html, body_text, sender_name, attachments, html_attachment, sample_recipient",
    )
    .eq("campaign_id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Mail snapshot not found (expired or missing)." };

  const sample = (data.sample_recipient ?? {}) as RecipientRow;
  const recipientEmail = sample.email?.trim() || "—";
  const subjectRaw = data.subject ?? "";
  const subject = applyMergeTags(subjectRaw, sample, { missingFormat: "plain" });
  const bodyHtmlRaw = data.body_html ?? "";
  const bodyTextRaw = data.body_text ?? "";
  const mergedHtml = applyMergeTags(bodyHtmlRaw, sample);
  const mergedText = applyMergeTags(bodyTextRaw, sample, { missingFormat: "plain" });
  const safeHtml = mergedHtml ? sanitizeEmailHtml(mergedHtml) : "";

  const attachments = listActivityAttachmentMeta(id, data.attachments, data.html_attachment);

  return {
    ok: true,
    data: {
      recipientEmail,
      subject,
      bodyHtml: safeHtml,
      bodyText: mergedText,
      senderName: data.sender_name,
      attachments,
    },
  };
}
