/**
 * Parallel per-SMTP campaign delivery: one sequential worker per account,
 * all workers run concurrently via Promise.all.
 *
 * Important: do NOT use a global mutex around every send — that serializes workers
 * and produces interleaved timestamps (A, B, A, B). IP rotation alone uses a lock.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Browser } from "puppeteer";
import type { Attachment } from "nodemailer/lib/mailer";
import { decryptSmtpPassword } from "@/lib/crypto/smtp-secret";
import { applyMergeTags, type RecipientRow } from "@/lib/merge-tags";
import {
  htmlToPlainText,
  sanitizeAttachmentRenderHtml,
  sanitizeEmailHtml,
} from "@/lib/html-email";
import {
  createRenderSemaphore,
  renderHtmlToJpegBuffer,
  renderHtmlToPdfBuffer,
  renderHtmlToPngBuffer,
} from "@/lib/html-attachment-render";
import { parsePositiveIntEnv, runAsyncPool } from "@/lib/async-pool";
import { withSmtpSendRetry } from "@/lib/smtp-retry";
import {
  recordGlobalSuccessfulSend,
  withGlobalSmtpSlot,
} from "@/lib/send-governor";
import { resolveMailEncoding } from "@/lib/mail-encoding";
import { buildSmtpUserTransport } from "@/lib/smtp/transport";
import { rotateOutboundIp, prepareLightsailEgressForCampaign } from "@/lib/outbound-ip";
import { isAwsLightsailRotationConfigured } from "@/lib/aws-outbound-ip";
import { usesProxyEgress } from "@/lib/egress-mode";
import { resolveSmtpEgressUrl } from "@/lib/smtp-egress-proxy";
import { resolveSmtpFromAddress } from "@/lib/smtp/from-address";
import {
  appendUnsubscribeFooter,
  buildDeliverabilityHeaders,
  resolveDeliverabilityProfile,
  extractAddress,
} from "@/lib/deliverability";
import { partitionRecipientsBySmtp } from "@/lib/smtp-distribution";
import { SendingLogBatcher, type SendingLogInsert } from "@/lib/db/batch-writes";

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

type IpHistoryEntry = {
  ip: string;
  started_at: string;
  ended_at?: string;
  sent: number;
  failed: number;
};

type HtmlAttachmentSpec = {
  kind: "pdf" | "png" | "jpeg" | "pdf_image";
  html: string;
};

const GENERATED_ATTACH_MAX_BYTES = 8 * 1024 * 1024;

/** Per-SMTP pause between sends on the same account (not global). */
const SMTP_INTER_SEND_MS = Math.max(
  0,
  parseInt(process.env.SMTP_INTER_SEND_MS ?? "0", 10) || 0,
);

/** Parallel in-flight sends per SMTP account (default 10). */
const SMTP_WORKER_CONCURRENCY = parsePositiveIntEnv("SMTP_WORKER_CONCURRENCY", 10);

function friendlyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadAlreadySentEmails(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<Set<string>> {
  const sent = new Set<string>();
  const { data, error } = await supabase
    .from("sending_logs")
    .select("recipient_email")
    .eq("campaign_id", campaignId);
  if (error) {
    console.warn(
      `[campaign-delivery] could not preload sent log for campaign=${campaignId}: ${error.message}`,
    );
    return sent;
  }
  for (const row of data ?? []) {
    const email = (row as { recipient_email?: string }).recipient_email?.trim().toLowerCase();
    if (email) sent.add(email);
  }
  return sent;
}

/** Serialize only IP-rotation bookkeeping (not every SMTP send). */
function createAsyncMutex() {
  let chain = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

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

function htmlAttachmentMeta(kind: HtmlAttachmentSpec["kind"]): {
  filename: string;
  contentType: string;
} {
  switch (kind) {
    case "pdf":
      return { filename: "attachment.pdf", contentType: "application/pdf" };
    case "jpeg":
      return { filename: "attachment.jpg", contentType: "image/jpeg" };
    case "pdf_image":
      return { filename: "attachment.png", contentType: "image/png" };
    case "png":
    default:
      return { filename: "attachment.png", contentType: "image/png" };
  }
}

export type ParallelDeliveryResult = {
  failed: number;
  sentInBurst: number;
  failedInBurst: number;
  pausedForRotation: boolean;
  ipHistory: IpHistoryEntry[];
};

export type ParallelDeliveryParams = {
  supabase: SupabaseClient;
  campaignId: string;
  userId: string;
  campaign: Record<string, unknown>;
  recipients: RecipientRow[];
  smtpList: SmtpRow[];
  rotationStrategy: string | null | undefined;
  senderName: string;
  staticAttachments: Attachment[];
  htmlAttSpec: HtmlAttachmentSpec | null;
  renderBrowser: Browser | null;
  suppressed: Set<string>;
  ipHistory: IpHistoryEntry[];
  rotationThreshold: number;
  manualIpRotationPause: boolean;
  onEmailSent: () => Promise<void>;
  /** When true, workers stop sending (plan cancelled, etc.). */
  shouldAbort?: () => Promise<boolean>;
};

export async function deliverCampaignInParallel(
  params: ParallelDeliveryParams,
): Promise<ParallelDeliveryResult> {
  const {
    supabase,
    campaignId,
    userId,
    campaign,
    recipients,
    smtpList,
    rotationStrategy,
    senderName,
    staticAttachments,
    htmlAttSpec,
    renderBrowser,
    suppressed,
    rotationThreshold,
    manualIpRotationPause,
    onEmailSent,
    shouldAbort,
  } = params;

  const withRotationLock = createAsyncMutex();
  const withStatsLock = createAsyncMutex();
  const sendingLogBatcher = new SendingLogBatcher(supabase);
  const renderSemaphore =
    renderBrowser && htmlAttSpec ? createRenderSemaphore() : null;
  const alreadySent = await loadAlreadySentEmails(supabase, campaignId);

  const shared = {
    failed: 0,
    sentInBurst: 0,
    failedInBurst: 0,
    pausedForRotation: false,
    ipHistory: params.ipHistory,
    rotationThreshold,
    recipientsTotal: recipients.length,
    alreadySent,
    /** Bumped after IP rotation so SMTP workers open fresh connections on the new egress IP. */
    smtpReconnectGeneration: 0,
    liveSent: 0,
    liveFailed: 0,
    lastProgressFlushAt: 0,
  };

  const [existingSentRes, existingFailedRes] = await Promise.all([
    supabase
      .from("sending_logs")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent"),
    supabase
      .from("sending_logs")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["failed", "bounced"]),
  ]);
  shared.liveSent = existingSentRes.count ?? 0;
  shared.liveFailed = existingFailedRes.count ?? 0;

  async function flushCampaignProgress(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - shared.lastProgressFlushAt < 400) return;
    shared.lastProgressFlushAt = now;
    await sendingLogBatcher.flush();
    await supabase
      .from("campaigns")
      .update({
        sent_count: shared.liveSent,
        failed_count: shared.liveFailed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
  }

  const partitions = partitionRecipientsBySmtp(
    recipients,
    smtpList.length,
    rotationStrategy,
    campaignId,
  );

  const workerSummaries = smtpList
    .map((smtp, idx) => {
      const n = partitions.get(idx)?.length ?? 0;
      return n > 0 ? `${smtpAccountLabel(smtp)}:${n}` : null;
    })
    .filter(Boolean);
  console.log(
    `[campaign-delivery] campaign=${campaignId} parallel_smtp_workers=${workerSummaries.length} ` +
      `per_smtp_concurrency=${SMTP_WORKER_CONCURRENCY} render_concurrency=${renderSemaphore?.concurrency ?? 0} ` +
      `queues=[${workerSummaries.join(", ")}]`,
  );

  /** Runs only when burst threshold may be hit — never on every send. */
  async function maybeRotateIpAfterBurst(): Promise<void> {
    if (shared.sentInBurst < shared.rotationThreshold) return;
    if (shared.pausedForRotation) return;

    await withRotationLock(async () => {
      if (shared.sentInBurst < shared.rotationThreshold) return;
      if (shared.pausedForRotation) return;

      const remaining = shared.recipientsTotal - shared.alreadySent.size;
      if (remaining <= 0) return;

      if (manualIpRotationPause) {
        shared.pausedForRotation = true;
        return;
      }

      const endedAt = new Date().toISOString();
      shared.ipHistory[0] = {
        ...shared.ipHistory[0]!,
        sent: shared.sentInBurst,
        failed: shared.failedInBurst,
        ended_at: endedAt,
      };
      const newIpRec = await rotateOutboundIp(supabase, userId);
      if (isAwsLightsailRotationConfigured()) {
        await prepareLightsailEgressForCampaign(
          newIpRec.ip,
          (await supabase
            .from("user_outbound_ip")
            .select("plan_rotation_index")
            .eq("user_id", userId)
            .maybeSingle()).data?.plan_rotation_index ?? 0,
        );
      }
      const startedAt = new Date().toISOString();
      shared.ipHistory.unshift({
        ip: newIpRec.ip,
        started_at: startedAt,
        sent: 0,
        failed: 0,
      });
      await supabase
        .from("campaigns")
        .update({
          current_outbound_ip: newIpRec.ip,
          outbound_ip_history: shared.ipHistory,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
      shared.sentInBurst = 0;
      shared.failedInBurst = 0;
      shared.smtpReconnectGeneration += 1;
      console.log(
        `[campaign-delivery] campaign=${campaignId} auto IP rotation after burst; new outbound ip=${newIpRec.ip} (~${remaining} recipients left). SMTP pools will reconnect.`,
      );
    });
  }

  async function recordSuccessfulSend(): Promise<void> {
    await withStatsLock(async () => {
      shared.sentInBurst += 1;
      if (shared.sentInBurst >= shared.rotationThreshold) {
        void maybeRotateIpAfterBurst();
      }
    });
    const globalRotate = await recordGlobalSuccessfulSend();
    if (globalRotate.rotated) {
      shared.smtpReconnectGeneration += 1;
    }
  }

  async function recordFailedSend(): Promise<void> {
    await withStatsLock(async () => {
      shared.failed += 1;
      shared.failedInBurst += 1;
    });
  }

  async function runSmtpWorker(smtpIndex: number, smtp: SmtpRow): Promise<void> {
    const queue = partitions.get(smtpIndex) ?? [];
    if (queue.length === 0) return;

    const smtpLabel = smtpAccountLabel(smtp);
    console.log(
      `[campaign-delivery] worker start smtp=${smtpLabel} queue=${queue.length} concurrency=${SMTP_WORKER_CONCURRENCY}`,
    );

    let pass: string;
    try {
      pass = decryptSmtpPassword(smtp.password_enc);
    } catch (e) {
      const errMsg = `SMTP password decrypt: ${friendlyErr(e)}`.slice(0, 2000);
      const failureLogs: SendingLogInsert[] = [];
      for (const { recipient } of queue) {
        const emailKey = recipient.email.trim().toLowerCase();
        if (shared.alreadySent.has(emailKey)) continue;
        shared.alreadySent.add(emailKey);
        await recordFailedSend();
        failureLogs.push({
          campaign_id: campaignId,
          user_id: userId,
          recipient_email: recipient.email,
          smtp_used: smtpLabel,
          status: "failed",
          error_message: errMsg,
        });
        shared.liveFailed += 1;
      }
      if (failureLogs.length > 0) {
        await sendingLogBatcher.pushMany(failureLogs);
        void flushCampaignProgress();
      }
      return;
    }

    const transportState: {
      generation: number;
      transporter: ReturnType<typeof buildSmtpUserTransport> | null;
      egressUrl: string | null;
    } = { generation: -1, transporter: null, egressUrl: null };

    async function ensureTransporter(): Promise<ReturnType<typeof buildSmtpUserTransport>> {
      const egressUrl = usesProxyEgress()
        ? await resolveSmtpEgressUrl(smtp.host, smtpIndex)
        : null;
      if (
        transportState.transporter &&
        transportState.generation === shared.smtpReconnectGeneration &&
        transportState.egressUrl === egressUrl
      ) {
        return transportState.transporter;
      }
      if (transportState.transporter) {
        transportState.transporter.close();
      }
      transportState.transporter = buildSmtpUserTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        username: smtp.username,
        password: pass,
        egressUrl,
      });
      transportState.egressUrl = egressUrl;
      transportState.generation = shared.smtpReconnectGeneration;
      return transportState.transporter;
    }

    async function sendOne({ recipient }: { recipient: RecipientRow }): Promise<void> {
      if (shared.pausedForRotation) return;
      if (shouldAbort && (await shouldAbort())) return;

      const emailKey = recipient.email.trim().toLowerCase();
      if (shared.alreadySent.has(emailKey)) return;

      if (suppressed.has(emailKey)) {
        shared.alreadySent.add(emailKey);
        await recordFailedSend();
        await sendingLogBatcher.push({
          campaign_id: campaignId,
          user_id: userId,
          recipient_email: recipient.email,
          smtp_used: null,
          status: "failed",
          error_message: "Recipient previously unsubscribed (skipped).",
        });
        shared.liveFailed += 1;
        void flushCampaignProgress();
        return;
      }

      const subj = applyMergeTags(
        (campaign.subject as string | null) ?? "No subject",
        recipient,
        { missingFormat: "plain" },
      );
      const sourceHtml = (campaign.body_html as string | null) ?? "";
      const safeHtml = sourceHtml ? sanitizeEmailHtml(sourceHtml) : "";
      const html = applyMergeTags(safeHtml, recipient, { missingFormat: "html" });
      const text = htmlToPlainText(html);
      const from = `${senderName} <${resolveSmtpFromAddress(smtp.username, smtp.host)}>`;

      const dynamicAttachments: Attachment[] = [];
      if (renderBrowser && htmlAttSpec) {
        const mergedAttachHtml = applyMergeTags(
          sanitizeAttachmentRenderHtml(htmlAttSpec.html),
          recipient,
          { missingFormat: "html" },
        );
        const render = async () => {
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
        };
        if (renderSemaphore) {
          await renderSemaphore.run(render);
        } else {
          await render();
        }
      }

      const allAttachments = [...staticAttachments, ...dynamicAttachments];
      const attachCount = allAttachments.length;
      const mimeEnc = resolveMailEncoding(
        (campaign.encoding as string | null) ?? "auto",
        { isHtml: safeHtml.trim().length > 0 },
        attachCount,
      );

      try {
        let htmlPart = html.trim();
        const textPart = text.trim();
        if (!htmlPart && !allAttachments.length) {
          throw new Error("Email content (HTML) is required.");
        }
        if (!htmlPart && allAttachments.length) {
          htmlPart = "<p>Please see the attached file(s).</p>";
        }
        const fallbackText =
          textPart ||
          (allAttachments.length && !html.trim() ? "Please see the attached file(s)." : "");
        const textBody = fallbackText.trim();

        const delivery = buildDeliverabilityHeaders({
          campaignId,
          userId,
          streamName: (campaign.stream_name as string | null) ?? null,
          recipientEmail: recipient.email,
          fromAddress: from,
          publicBaseUrl: process.env.MAILER_PUBLIC_URL?.trim() || null,
          unsubscribeMailbox:
            process.env.MAILER_UNSUBSCRIBE_MAILBOX?.trim() || null,
        });

        const profile = resolveDeliverabilityProfile(from, recipient.email);
        const withFooter = appendUnsubscribeFooter({
          html: htmlPart,
          text: textBody,
          unsubscribeMailto: delivery.unsubscribeMailto,
          unsubscribeUrl: delivery.unsubscribeUrl,
          postalAddress: process.env.MAILER_POSTAL_ADDRESS?.trim() || null,
          profile,
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

        const fromAddr = extractAddress(from);
        await withGlobalSmtpSlot(() =>
          withSmtpSendRetry(async () => {
            await (await ensureTransporter()).sendMail({
              from,
              to: recipient.email,
              envelope: {
                from: fromAddr,
                to: recipient.email,
              },
              replyTo: delivery.replyTo,
              messageId: delivery.messageId,
              subject: subj,
              headers: delivery.headers,
              text: textPayload || undefined,
              html: htmlPayload || undefined,
              ...(allAttachments.length ? { attachments: allAttachments } : {}),
            });
          }),
        );

        shared.alreadySent.add(emailKey);
        const sentAt = new Date().toISOString();
        await sendingLogBatcher.push({
          campaign_id: campaignId,
          user_id: userId,
          recipient_email: recipient.email,
          smtp_used: smtpLabel,
          status: "sent",
          error_message: null,
          sent_at: sentAt,
        });
        shared.liveSent += 1;
        void flushCampaignProgress();
        await onEmailSent();
        await recordSuccessfulSend();

        if (SMTP_INTER_SEND_MS > 0) {
          await sleep(SMTP_INTER_SEND_MS);
        }
      } catch (e) {
        shared.alreadySent.add(emailKey);
        await recordFailedSend();
        await sendingLogBatcher.push({
          campaign_id: campaignId,
          user_id: userId,
          recipient_email: recipient.email,
          smtp_used: smtpLabel,
          status: "failed",
          error_message: friendlyErr(e).slice(0, 2000),
        });
        shared.liveFailed += 1;
        void flushCampaignProgress();
      }
    }

    try {
      await runAsyncPool(queue, SMTP_WORKER_CONCURRENCY, async (item) => {
        await sendOne(item);
      });
    } finally {
      if (transportState.transporter) {
        transportState.transporter.close();
        transportState.transporter = null;
      }
    }

    console.log(`[campaign-delivery] worker done smtp=${smtpLabel}`);
  }

  await Promise.all(
    smtpList.map((smtp, smtpIndex) => runSmtpWorker(smtpIndex, smtp)),
  );

  await sendingLogBatcher.flush();
  await flushCampaignProgress(true);

  return {
    failed: shared.failed,
    sentInBurst: shared.sentInBurst,
    failedInBurst: shared.failedInBurst,
    pausedForRotation: shared.pausedForRotation,
    ipHistory: shared.ipHistory,
  };
}
