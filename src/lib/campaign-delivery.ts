/**
 * Delivers a campaign with Nodemailer (used by the BullMQ worker and by the API
 * when Redis is not configured, for local development).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Browser } from "puppeteer";
import { type RecipientRow } from "@/lib/merge-tags";
import { nodemailerAttachmentsFromCampaignField } from "@/lib/campaign-attachments";
import { launchRenderBrowser } from "@/lib/html-attachment-render";
import { hasNonExpiredActivePlan } from "@/lib/active-plan-guard";
import {
  DEFAULT_ROTATION_THRESHOLD,
  getOrCreateOutboundIp,
} from "@/lib/outbound-ip";
import { deliverCampaignInParallel } from "@/lib/campaign-delivery-parallel";
import {
  createCampaignAbortChecker,
  isCampaignCancelled,
} from "@/lib/campaign-cancel";

type SmtpRow = {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password_enc: string;
  label: string | null;
  rotation_order: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalise `campaigns.smtp_server_ids` (uuid[]) from PostgREST — handles a plain
 * array of strings, Postgres `{uuid,uuid}` text, or JSON string.
 */
export function normalizeCampaignSmtpServerIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter(
      (x): x is string => typeof x === "string" && UUID_RE.test(x.trim()),
    );
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const vals = Object.values(raw as Record<string, unknown>).filter(
      (x): x is string => typeof x === "string" && UUID_RE.test(x.trim()),
    );
    if (vals.length > 0) return vals;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("{") && s.endsWith("}")) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return inner
        .split(",")
        .map((p) => p.trim().replace(/^"|"$/g, ""))
        .filter((x) => UUID_RE.test(x));
    }
    try {
      const j = JSON.parse(s) as unknown;
      if (Array.isArray(j)) return normalizeCampaignSmtpServerIds(j);
    } catch {
      /* ignore */
    }
    if (UUID_RE.test(s)) return [s];
  }
  return [];
}

/** Log + UI: disambiguate rows that share the same username@host (e.g. duplicate imports). */
function smtpAccountLabel(smtp: SmtpRow): string {
  const user = smtp.username.trim();
  const host = smtp.host.trim();
  const lab = smtp.label?.trim();
  const idShort = smtp.id.replace(/-/g, "").slice(0, 8);
  const core = `${user} @ ${host}`;
  const withLab =
    lab && lab.length > 0 && !lab.includes(user)
      ? `${lab} — ${core}`
      : core;
  return `${withLab} [id:${idShort}]`.slice(0, 500);
}

function dedupeSmtpRowsById(rows: SmtpRow[]): SmtpRow[] {
  const seen = new Set<string>();
  const out: SmtpRow[] = [];
  for (const r of rows) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function friendlyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

type HtmlAttachmentKind = "pdf" | "png" | "jpeg";
type HtmlAttachmentSpec = { kind: HtmlAttachmentKind; html: string };

function parseHtmlAttachment(raw: unknown): HtmlAttachmentSpec | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "pdf" && o.kind !== "png" && o.kind !== "jpeg") return null;
  const html = typeof o.html === "string" ? o.html.trim() : "";
  if (!html) return null;
  return { kind: o.kind, html };
}

export async function deductOneEmailCredit(
  supabase: SupabaseClient,
  userId: string,
  note: string,
): Promise<void> {
  if (process.env.ALLOW_SEND_WITHOUT_EMAIL_CREDITS === "1") return;
  if (await hasNonExpiredActivePlan(supabase, userId)) return;
  const { data: row, error: r0 } = await supabase
    .from("credits")
    .select("email_credits, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (r0 || !row) return;
  if (row.expires_at) {
    const t = Date.parse(String(row.expires_at));
    if (Number.isFinite(t) && t <= Date.now()) return;
  }
  const cur = Math.max(0, Math.floor(row.email_credits ?? 0));
  if (cur < 1) return;
  const { error: up } = await supabase
    .from("credits")
    .update({ email_credits: cur - 1, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("email_credits", cur);
  if (up) return;
  await supabase.from("credit_transactions").insert({
    user_id: userId,
    type: "deducted",
    credit_type: "email",
    amount: 1,
    note: note.slice(0, 500),
  });
}

type IpHistoryEntry = {
  ip: string;
  started_at: string;
  ended_at?: string;
  sent: number;
  failed: number;
};

/**
 * Load campaign, send each message via saved SMTP, write logs, update status.
 * Expects a Supabase client with service role.
 *
 * IP rotation after each burst of successful sends (`ip_rotation_threshold`):
 *   - On entry, the user's current outbound IP is snapshotted onto the
 *     campaign and prepended to `outbound_ip_history`.
 *   - After every successful send, a per-burst counter is bumped. When it
 *     reaches the threshold and more recipients remain, either the campaign
 *     pauses for manual rotation (env `CAMPAIGN_MANUAL_IP_ROTATION_PAUSE=1`)
 *     or `rotateOutboundIp` runs automatically and sending continues
 *     (`OUTBOUND_IP_ROTATION_URL` for a real egress IP from your provider).
 *   - Already-sent recipients have rows in `sending_logs`, so any re-entry
 *     skips them (idempotency).
 */
export async function runSendCampaign(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string,
): Promise<void> {
  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select(
      "id, user_id, status, subject, body_html, body_text, sender_name, stream_name, recipients, smtp_server_ids, total_emails, attachment_paths, html_attachment, encoding, ip_rotation_threshold, outbound_ip_history, rotation_strategy",
    )
    .eq("id", campaignId)
    .single();

  if (cErr) {
    // Bubble the real Postgres error (e.g. "column campaigns.last_error does
    // not exist" after a missed migration) rather than the generic
    // "Campaign not found" we used to throw — that string actively hid the
    // real cause and forced manual investigation on every silent failure.
    throw new Error(
      `Failed to load campaign ${campaignId}: ${cErr.message || friendlyErr(cErr)}`,
    );
  }
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found (no row returned)`);
  }
  if (campaign.user_id !== userId) {
    throw new Error("Campaign user mismatch");
  }

  if ((campaign as { status?: string }).status === "cancelled") {
    console.log(
      `[campaign-delivery] campaign=${campaignId} already cancelled — skipping delivery.`,
    );
    return;
  }

  const shouldAbort = createCampaignAbortChecker(supabase, campaignId);

  const recipients = (campaign.recipients as RecipientRow[]) ?? [];
  if (recipients.length === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", campaignId);
    throw new Error("No recipients on campaign");
  }

  // Resolve the IP to use for this batch and the burst threshold. Reads use
  // the supplied client; for the BullMQ worker / sync send path that's the
  // service-role client, which sidesteps RLS so the rotation row is always
  // accessible regardless of who originally created it.
  const ipState = await getOrCreateOutboundIp(supabase, userId);
  const ipBatchStartedAt = new Date().toISOString();
  const rotationThreshold = (() => {
    const onCampaign = (campaign as { ip_rotation_threshold?: number | null })
      .ip_rotation_threshold;
    if (Number.isFinite(onCampaign) && (onCampaign as number) > 0) {
      return Number(onCampaign);
    }
    return ipState.rotationThreshold || DEFAULT_ROTATION_THRESHOLD;
  })();
  const existingHistory = (() => {
    const raw = (campaign as { outbound_ip_history?: unknown }).outbound_ip_history;
    return Array.isArray(raw) ? (raw as IpHistoryEntry[]) : [];
  })();
  const ipHistory: IpHistoryEntry[] = [
    { ip: ipState.ip, started_at: ipBatchStartedAt, sent: 0, failed: 0 },
    ...existingHistory,
  ];

  let q = supabase
    .from("smtp_servers")
    .select("id, host, port, secure, username, password_enc, label, rotation_order")
    .eq("user_id", userId);

  const serverIds = normalizeCampaignSmtpServerIds(campaign.smtp_server_ids);
  if (serverIds.length > 0) {
    q = q.in("id", serverIds);
  }

  const { data: smtps, error: sErr } = await q
    .order("rotation_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (sErr) throw sErr;
  let smtpList = dedupeSmtpRowsById((smtps ?? []) as SmtpRow[]);
  let smtpFilterFallback = false;

  // Campaign snapshot lists multiple SMTP ids but only one row matched (stale
  // UUIDs, partial import, or PostgREST filter oddities). Using that single row
  // would send everything through one account — fall back to all saved SMTPs.
  if (serverIds.length > 1 && smtpList.length === 1) {
    smtpFilterFallback = true;
    console.warn(
      `[campaign-delivery] campaign=${campaignId} smtp_server_ids had ${serverIds.length} id(s) ` +
        `but only 1 row matched user_id=${userId}; loading all SMTP servers for this user instead.`,
    );
    const { data: allSmtps, error: allErr } = await supabase
      .from("smtp_servers")
      .select("id, host, port, secure, username, password_enc, label, rotation_order")
      .eq("user_id", userId)
      .order("rotation_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (allErr) throw allErr;
    smtpList = dedupeSmtpRowsById((allSmtps ?? []) as SmtpRow[]);
  }

  if (smtpList.length === 0) {
    const msg = "No SMTP server configured. Add one under SMTP Configuration.";
    await supabase
      .from("campaigns")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", campaignId);
    throw new Error(msg);
  }

  const rotationStrategy = (campaign as { rotation_strategy?: string | null })
    .rotation_strategy;
  const identityKeys = new Set(
    smtpList.map((s) => `${s.username.trim().toLowerCase()}|${s.host.trim().toLowerCase()}`),
  );
  if (smtpList.length > 1 && identityKeys.size === 1) {
    console.warn(
      `[campaign-delivery] campaign=${campaignId} ${smtpList.length} SMTP rows share the same login ` +
        `(${[...identityKeys][0]}). Rotation uses different DB rows but the same mailbox — use distinct accounts.`,
    );
  }
  console.log(
    `[campaign-delivery] campaign=${campaignId} smtp_accounts=${smtpList.length} ` +
      `rotation=${String(rotationStrategy ?? "round_robin")} ` +
      `smtp_filter=${serverIds.length > 0 ? `${serverIds.length} id(s)` : "all for user"}` +
      `${smtpFilterFallback ? " (expanded: snapshot matched 1 row)" : ""}`,
  );

  if (await shouldAbort()) {
    console.log(
      `[campaign-delivery] campaign=${campaignId} cancelled before send loop — exiting.`,
    );
    return;
  }

  await supabase
    .from("campaigns")
    .update({
      status: "sending",
      pause_reason: null,
      paused_at: null,
      current_outbound_ip: ipState.ip,
      ip_rotation_threshold: rotationThreshold,
      outbound_ip_history: ipHistory,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .neq("status", "cancelled");

  // Load this sender's suppression list once. Recipients on it are silently
  // skipped (logged with status='failed', error_message='unsubscribed') so we
  // never email someone who clicked Unsubscribe — required by CAN-SPAM and a
  // strong reputation signal for Outlook / Gmail. Falls back to an empty set
  // when the `unsubscribes` table doesn't exist yet (migration not applied).
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
        `[campaign-delivery] could not load suppression list for user=${userId}: ${error.message}`,
      );
    }
  } catch (e) {
    console.warn(
      `[campaign-delivery] suppression list query threw: ${friendlyErr(e)}`,
    );
  }

  const senderName = (campaign.sender_name as string | null)?.trim() || "My Mail";
  const mailAttachments = nodemailerAttachmentsFromCampaignField(
    campaign.attachment_paths,
  );
  const htmlAttSpec = parseHtmlAttachment(
    (campaign as { html_attachment?: unknown }).html_attachment,
  );
  const staticAttachments = mailAttachments ?? [];

  let renderBrowser: Browser | null = null;
  if (htmlAttSpec) {
    try {
      renderBrowser = await launchRenderBrowser();
    } catch (e) {
      console.warn(
        `[campaign-delivery] campaign=${campaignId} HTML attachment renderer unavailable ` +
          `(sending email body only): ${friendlyErr(e)}. ` +
          "On Ubuntu run: bash scripts/install-chromium-deps.sh",
      );
    }
  }
  const rawAttachLen = Array.isArray(campaign.attachment_paths)
    ? campaign.attachment_paths.length
    : typeof campaign.attachment_paths === "string"
      ? -1
      : 0;
  console.log(
    `[campaign-delivery] campaign=${campaignId} raw_attachment_paths_len=${rawAttachLen} decoded_attachments=${
      mailAttachments?.length ?? 0
    }${
      mailAttachments?.length
        ? " files=" +
          mailAttachments
            .map(
              (a) =>
                `${a.filename}(${
                  a.content instanceof Buffer ? a.content.length : "?"
                }B)`,
            )
            .join(",")
        : ""
    }`,
  );
  if (rawAttachLen > 0 && (mailAttachments?.length ?? 0) === 0) {
    console.warn(
      `[campaign-delivery] campaign=${campaignId} attachment_paths has ${rawAttachLen} rows but 0 decoded attachments — contentBase64 was empty or invalid.`,
    );
  }
  const manualIpRotationPause =
    process.env.CAMPAIGN_MANUAL_IP_ROTATION_PAUSE === "1";

  let failed = 0;
  let failedInBurst = 0;
  let sentInBurst = 0;
  let pausedForRotation = false;

  try {
    const parallelResult = await deliverCampaignInParallel({
      supabase,
      campaignId,
      userId,
      campaign: campaign as Record<string, unknown>,
      recipients,
      smtpList,
      rotationStrategy,
      senderName,
      staticAttachments,
      htmlAttSpec,
      renderBrowser,
      suppressed,
      ipHistory,
      rotationThreshold,
      manualIpRotationPause,
      onEmailSent: () =>
        deductOneEmailCredit(
          supabase,
          userId,
          `Email send: campaign ${campaignId}`,
        ),
      shouldAbort,
    });
    failed = parallelResult.failed;
    sentInBurst = parallelResult.sentInBurst;
    failedInBurst = parallelResult.failedInBurst;
    pausedForRotation = parallelResult.pausedForRotation;
    ipHistory.splice(0, ipHistory.length, ...parallelResult.ipHistory);
  } finally {
    if (renderBrowser) {
      await renderBrowser.close().catch(() => {});
    }
  }

  // Roll the latest sent/failed counts into the head of the IP history so
  // the UI can surface a per-burst report later if it wants to.
  const updatedHistory = ipHistory.map((entry, idx) =>
    idx === 0
      ? {
          ...entry,
          sent: sentInBurst,
          failed: failedInBurst,
          ended_at: new Date().toISOString(),
        }
      : entry,
  );

  // Re-read totals from `sending_logs` so resume after a pause carries the
  // running totals from prior bursts, not just this batch.
  const totalsRes = await supabase
    .from("sending_logs")
    .select("status", { count: "exact" })
    .eq("campaign_id", campaignId);
  const allRows = (totalsRes.data ?? []) as { status: string }[];
  const totalSent = allRows.filter((r) => r.status === "sent").length;
  const totalFailed = allRows.filter(
    (r) => r.status === "failed" || r.status === "bounced",
  ).length;

  if (await isCampaignCancelled(supabase, campaignId)) {
    await supabase
      .from("campaigns")
      .update({
        sent_count: totalSent,
        failed_count: totalFailed,
        outbound_ip_history: updatedHistory,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
    console.log(
      `[campaign-delivery] campaign=${campaignId} stopped (cancelled). sent=${totalSent} failed=${totalFailed}`,
    );
    return;
  }

  if (pausedForRotation) {
    await supabase
      .from("campaigns")
      .update({
        status: "paused",
        pause_reason: "rotate_ip",
        paused_at: new Date().toISOString(),
        sent_count: totalSent,
        failed_count: totalFailed,
        outbound_ip_history: updatedHistory,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
    console.log(
      `[campaign-delivery] campaign=${campaignId} paused for IP rotation after ${sentInBurst} sends in this burst (total sent: ${totalSent}/${recipients.length}).`,
    );
    return;
  }

  const finalStatus = totalSent > 0 ? "completed" : "failed";
  await supabase
    .from("campaigns")
    .update({
      status: finalStatus,
      pause_reason: null,
      paused_at: null,
      sent_count: totalSent,
      failed_count: totalFailed,
      outbound_ip_history: updatedHistory,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
}
