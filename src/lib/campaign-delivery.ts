/**
 * Delivers a campaign with Nodemailer (used by the BullMQ worker and by the API
 * when Redis is not configured, for local development).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSmtpPassword } from "@/lib/crypto/smtp-secret";
import type { Browser } from "puppeteer";
import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import { nodemailerAttachmentsFromCampaignField } from "@/lib/campaign-attachments";
import {
  htmlToPlainText,
  sanitizeAttachmentRenderHtml,
  sanitizeEmailHtml,
} from "@/lib/html-email";
import {
  launchRenderBrowser,
  renderHtmlToJpegBuffer,
  renderHtmlToPdfBuffer,
  renderHtmlToPngBuffer,
} from "@/lib/html-attachment-render";
import { resolveMailEncoding } from "@/lib/mail-encoding";
import { buildSmtpUserTransport } from "@/lib/smtp/transport";
import { hasNonExpiredActivePlan } from "@/lib/active-plan-guard";
import {
  DEFAULT_ROTATION_THRESHOLD,
  getOrCreateOutboundIp,
} from "@/lib/outbound-ip";
import {
  appendUnsubscribeFooter,
  buildDeliverabilityHeaders,
} from "@/lib/deliverability";

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

function friendlyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

type HtmlAttachmentKind = "pdf" | "png" | "jpeg";
type HtmlAttachmentSpec = { kind: HtmlAttachmentKind; html: string };

const GENERATED_ATTACH_MAX_BYTES = 8 * 1024 * 1024;

function parseHtmlAttachment(raw: unknown): HtmlAttachmentSpec | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind !== "pdf" && o.kind !== "png" && o.kind !== "jpeg") return null;
  const html = typeof o.html === "string" ? o.html.trim() : "";
  if (!html) return null;
  return { kind: o.kind, html };
}

function htmlAttachmentMeta(kind: HtmlAttachmentKind): {
  filename: string;
  contentType: string;
} {
  switch (kind) {
    case "pdf":
      return { filename: "attachment.pdf", contentType: "application/pdf" };
    case "jpeg":
      return { filename: "attachment.jpg", contentType: "image/jpeg" };
    case "png":
    default:
      return { filename: "attachment.png", contentType: "image/png" };
  }
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
 * IP-rotation pause/resume contract:
 *   - On entry, the user's current outbound IP is snapshotted onto the
 *     campaign and prepended to `outbound_ip_history`.
 *   - After every successful send, an "in this batch" counter is bumped.
 *     When it reaches the configured `ip_rotation_threshold`, the campaign
 *     is set to `status='paused'`, `pause_reason='rotate_ip'`, and the
 *     function returns cleanly. Already-sent recipients have rows in
 *     `sending_logs`, so the next call to `runSendCampaign` skips them and
 *     resumes from the cursor naturally (existing idempotency check below).
 */
export async function runSendCampaign(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string,
): Promise<void> {
  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select(
      "id, user_id, subject, body_html, body_text, sender_name, stream_name, recipients, smtp_server_ids, total_emails, attachment_paths, html_attachment, encoding, ip_rotation_threshold, outbound_ip_history",
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

  const serverIds = campaign.smtp_server_ids as string[] | null;
  if (serverIds && serverIds.length > 0) {
    q = q.in("id", serverIds);
  }

  const { data: smtps, error: sErr } = await q.order("rotation_order", { ascending: true });
  if (sErr) throw sErr;
  const smtpList = (smtps ?? []) as SmtpRow[];
  if (smtpList.length === 0) {
    const msg = "No SMTP server configured. Add one under SMTP Configuration.";
    await supabase
      .from("campaigns")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", campaignId);
    throw new Error(msg);
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
    .eq("id", campaignId);

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
      const msg = `Could not start HTML attachment renderer: ${friendlyErr(e)}`;
      console.error(`[campaign-delivery] campaign=${campaignId} ${msg}`);
      await supabase
        .from("campaigns")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", campaignId);
      throw new Error(msg);
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
  // `failed` is the per-batch counter only; running totals (across resumes)
  // are re-derived from `sending_logs` after the loop so the campaign row is
  // always in sync with the audit log even when paused/resumed multiple times.
  let failed = 0;
  let sentInBurst = 0;
  let pausedForRotation = false;

  try {
  for (let i = 0; i < recipients.length; i++) {
    const row = recipients[i];
    const smtp = smtpList[i % smtpList.length];

    const { data: already } = await supabase
      .from("sending_logs")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("recipient_email", row.email)
      .maybeSingle();
    if (already) {
      continue;
    }

    // Honour the suppression list — recipients who clicked Unsubscribe on a
    // prior campaign get a "failed" log row (so the UI surfaces it) and we
    // skip the actual SMTP send. Counted as `failed` so the running total in
    // the campaign row stays consistent with the audit log.
    if (suppressed.has(row.email.trim().toLowerCase())) {
      failed += 1;
      await supabase.from("sending_logs").insert({
        campaign_id: campaignId,
        user_id: userId,
        recipient_email: row.email,
        smtp_used: null,
        status: "failed",
        error_message: "Recipient previously unsubscribed (skipped).",
      });
      continue;
    }

    let pass: string;
    try {
      pass = decryptSmtpPassword(smtp.password_enc);
    } catch (e) {
      failed += 1;
      await supabase.from("sending_logs").insert({
        campaign_id: campaignId,
        user_id: userId,
        recipient_email: row.email,
        smtp_used: smtp.host,
        status: "failed",
        error_message: `SMTP password decrypt: ${friendlyErr(e)}`.slice(0, 2000),
      });
      continue;
    }

    const subj = applyMergeTags(
      (campaign.subject as string | null) ?? "No subject",
      row,
    );
    const sourceHtml = (campaign.body_html as string | null) ?? "";
    const safeHtml = sourceHtml ? sanitizeEmailHtml(sourceHtml) : "";
    const html = applyMergeTags(safeHtml, row);
    // Always regenerate text from the (sanitised) HTML — ignore any stored body_text so the
    // two MIME parts never drift out of sync.
    const text = applyMergeTags(htmlToPlainText(safeHtml), row);
    const from = `${senderName} <${smtp.username}>`;

    const dynamicAttachments: NonNullable<typeof mailAttachments> = [];
    if (renderBrowser && htmlAttSpec) {
      const mergedAttachHtml = applyMergeTags(
        sanitizeAttachmentRenderHtml(htmlAttSpec.html),
        row,
      );
      const buf =
        htmlAttSpec.kind === "pdf"
          ? await renderHtmlToPdfBuffer(renderBrowser, mergedAttachHtml)
          : htmlAttSpec.kind === "jpeg"
            ? await renderHtmlToJpegBuffer(renderBrowser, mergedAttachHtml)
            : await renderHtmlToPngBuffer(renderBrowser, mergedAttachHtml);
      if (buf.length > GENERATED_ATTACH_MAX_BYTES) {
        throw new Error("Generated attachment is too large (max 8 MB).");
      }
      const meta = htmlAttachmentMeta(htmlAttSpec.kind);
      dynamicAttachments.push({
        filename: meta.filename,
        content: buf,
        contentType: meta.contentType,
      });
    }
    const allAttachments = [...staticAttachments, ...dynamicAttachments];
    const attachCount = allAttachments.length;
    const mimeEnc = resolveMailEncoding(
      (campaign.encoding as string | null) ?? "auto",
      { isHtml: safeHtml.trim().length > 0 },
      attachCount,
    );

    const transporter = buildSmtpUserTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      username: smtp.username,
      password: pass,
    });

    try {
      const htmlPart = html.trim();
      const textPart = text.trim();
      if (!htmlPart && !allAttachments.length) {
        throw new Error("Email content (HTML) is required.");
      }
      const fallbackText =
        textPart ||
        (allAttachments.length && !htmlPart
          ? "Please see the attached file(s)."
          : "");
      const textBody = fallbackText.trim();

      // Per-recipient deliverability headers + Reply-To + stable Message-ID.
      // Yahoo and Gmail bulk-sender requirements (Feb 2024) lean heavily on
      // List-Unsubscribe being present, so we set it for every send. The
      // HTTPS one-click variant is added when MAILER_PUBLIC_URL is configured.
      const delivery = buildDeliverabilityHeaders({
        campaignId: campaignId,
        userId,
        streamName: (campaign.stream_name as string | null) ?? null,
        recipientEmail: row.email,
        fromAddress: from,
        publicBaseUrl: process.env.MAILER_PUBLIC_URL?.trim() || null,
        unsubscribeMailbox:
          process.env.MAILER_UNSUBSCRIBE_MAILBOX?.trim() || null,
      });

      // Inject a small unsubscribe footer (and optional postal address) when
      // the template doesn't already ship one. CAN-SPAM + Yahoo both expect a
      // visible unsubscribe affordance in the body, not just in headers.
      const withFooter = appendUnsubscribeFooter({
        html: htmlPart,
        text: textBody,
        unsubscribeMailto: delivery.unsubscribeMailto,
        unsubscribeUrl: delivery.unsubscribeUrl,
        postalAddress: process.env.MAILER_POSTAL_ADDRESS?.trim() || null,
      });

      const textPayload =
        withFooter.text &&
        ({
          content: withFooter.text,
          contentTransferEncoding: mimeEnc.textContentTransferEncoding,
        } as const);
      const htmlPayload =
        withFooter.html &&
        ({
          content: withFooter.html,
          contentTransferEncoding: mimeEnc.htmlContentTransferEncoding,
        } as const);
      await transporter.sendMail({
        from,
        to: row.email,
        replyTo: delivery.replyTo,
        messageId: delivery.messageId,
        subject: subj,
        headers: delivery.headers,
        text: textPayload || undefined,
        html: htmlPayload || undefined,
        ...(allAttachments.length ? { attachments: allAttachments } : {}),
      });
      transporter.close();
      await supabase.from("sending_logs").insert({
        campaign_id: campaignId,
        user_id: userId,
        recipient_email: row.email,
        smtp_used: smtp.host,
        status: "sent",
        error_message: null,
      });
      await deductOneEmailCredit(supabase, userId, `Email send: campaign ${campaignId}`);
      sentInBurst += 1;

      // Check whether the next recipient would push us past the burst limit.
      // We only pause when there's actually more work to do — otherwise the
      // campaign just completes naturally on the next loop iteration.
      const remaining = recipients.length - (i + 1);
      if (sentInBurst >= rotationThreshold && remaining > 0) {
        pausedForRotation = true;
        break;
      }
    } catch (e) {
      transporter.close();
      failed += 1;
      await supabase.from("sending_logs").insert({
        campaign_id: campaignId,
        user_id: userId,
        recipient_email: row.email,
        smtp_used: smtp.host,
        status: "failed",
        error_message: friendlyErr(e).slice(0, 2000),
      });
    }
  }
  } finally {
    if (renderBrowser) {
      await renderBrowser.close().catch(() => {});
    }
  }

  // Roll the latest sent/failed counts into the head of the IP history so
  // the UI can surface a per-burst report later if it wants to.
  const updatedHistory = ipHistory.map((entry, idx) =>
    idx === 0
      ? { ...entry, sent: sentInBurst, failed, ended_at: new Date().toISOString() }
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
