import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSendCampaign } from "@/lib/campaign-delivery";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  getEmailQueue,
  isQueueConfigured,
  pingRedis,
  disposeEmailQueue,
} from "@/lib/queue/email-queue";
import {
  requireActivePlanForMailOrJson,
  hasNonExpiredActivePlan,
} from "@/lib/active-plan-guard";

/** Max recipients delivered synchronously in the request when Redis is not available. */
const MAX_SYNC_RECIPIENTS = 200;

/** Tight budget for the runtime Redis reachability probe. */
const REDIS_PROBE_MS = 1_500;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id: campaignId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const planBlock = await requireActivePlanForMailOrJson(supabase, user.id);
  if (planBlock) return planBlock;

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("id, user_id, status, total_emails")
    .eq("id", campaignId)
    .single();

  if (cErr || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const need = Math.max(0, campaign.total_emails ?? 0);
  if (need === 0) {
    return NextResponse.json(
      { error: "This campaign has no recipients." },
      { status: 400 },
    );
  }

  const { data: creditsRow } = await supabase
    .from("credits")
    .select("email_credits, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  function creditsExpired(iso: string | null | undefined): boolean {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    return t <= Date.now();
  }

  const available = creditsExpired(creditsRow?.expires_at)
    ? 0
    : Math.max(0, Math.floor(creditsRow?.email_credits ?? 0));
  const skipCreditCheck = process.env.ALLOW_SEND_WITHOUT_EMAIL_CREDITS === "1";
  const planCoversSends = await hasNonExpiredActivePlan(supabase, user.id);
  if (!skipCreditCheck && !planCoversSends && available < need) {
    return NextResponse.json(
      {
        error: `Not enough email credits. Need ${need}, have ${available}. With an active server plan (Wallet & Plan), credits are not required; otherwise ask an admin to assign email credits, or set ALLOW_SEND_WITHOUT_EMAIL_CREDITS=1 in .env.local for local testing only.`,
      },
      { status: 400 },
    );
  }

  /**
   * Decide queue vs sync at *runtime*, not just by env var presence. If
   * REDIS_URL is set but Redis is unreachable (typical for dev when the user
   * forgot to start their Docker container), fall through to the synchronous
   * delivery path so the send still succeeds — the Nodemailer code path is
   * identical to the worker's.
   */
  const wantQueue = isQueueConfigured();
  const queueLive = wantQueue ? await pingRedis(REDIS_PROBE_MS) : false;
  const queue = queueLive ? getEmailQueue() : null;

  if (wantQueue && !queueLive) {
    console.warn(
      `[api/campaigns/send] REDIS_URL is set but Redis is not reachable; ` +
        `falling back to in-process delivery for campaign ${campaignId}. ` +
        `Start Redis (e.g. \`docker run -d -p 6379:6379 redis:7\`) and restart \`npm run dev\` to use the queue.`,
    );
    // Drop any cached connection / queue stuck in reconnect-loop so the next
    // request creates a fresh one once Redis is back.
    await disposeEmailQueue();
  }

  if (queue) {
    const { error: upErr } = await supabase
      .from("campaigns")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", campaignId);
    if (upErr) {
      return NextResponse.json(
        { error: `Could not mark campaign queued: ${upErr.message}` },
        { status: 500 },
      );
    }

    const QUEUE_ADD_MS = 18_000;
    try {
      await Promise.race([
        queue.add(
          "send-campaign",
          { campaignId, userId: user.id },
          { removeOnComplete: true },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("QUEUE_ADD_TIMEOUT")),
            QUEUE_ADD_MS,
          ),
        ),
      ]);
    } catch (e) {
      const reverted = new Date().toISOString();
      await supabase
        .from("campaigns")
        .update({ status: "draft", updated_at: reverted })
        .eq("id", campaignId);

      const isTimeout =
        e instanceof Error && e.message === "QUEUE_ADD_TIMEOUT";
      const detail =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
      return NextResponse.json(
        {
          error: isTimeout
            ? `Timed out after ${QUEUE_ADD_MS / 1000}s talking to Redis (queue job). Check REDIS_URL, ensure Redis is running (e.g. local Docker on 6379), and restart the dev server. Campaign was reset to draft.`
            : `Could not queue send: ${detail}. Campaign was reset to draft. Check Redis and try again.`,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, mode: "queued" as const });
  }

  if (need > MAX_SYNC_RECIPIENTS) {
    const reason = wantQueue
      ? `REDIS_URL is set but Redis is not reachable from the server, so the queue cannot be used right now. ` +
        `This campaign has ${need} recipients (max ${MAX_SYNC_RECIPIENTS} for in-process delivery). ` +
        `Start Redis (e.g. \`docker run -d -p 6379:6379 redis:7\`) + the worker, or split the campaign into smaller batches.`
      : `This campaign has ${need} recipients. For more than ${MAX_SYNC_RECIPIENTS}, set REDIS_URL and ensure the email worker is running (npm run dev with REDIS_URL, or npm run worker).`;
    return NextResponse.json({ error: reason }, { status: 503 });
  }

  /**
   * Mark the campaign as `sending` synchronously so the Sending & Logs tab
   * sees state change immediately, then run the actual delivery in the
   * background and respond. The user gets a fast toast (< 1 s) instead of
   * waiting for SMTP + per-recipient HTML→PDF rendering to finish.
   *
   * Note: Next.js (Node runtime) keeps the process alive after the response,
   * so the unawaited promise completes normally. The campaign row's status
   * (`sending` → `completed`/`failed`) and `sending_logs` rows are the
   * source of truth for progress, polled by the UI.
   */
  const service = createServiceClient();
  const { error: markErr } = await service
    .from("campaigns")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (markErr) {
    return NextResponse.json(
      { error: `Could not mark campaign sending: ${markErr.message}` },
      { status: 500 },
    );
  }

  void runSendCampaign(service, campaignId, user.id).catch(async (e) => {
    const message = e instanceof Error ? e.message : "Delivery failed";
    console.error(
      `[api/campaigns/send] background delivery failed for ${campaignId}:`,
      message,
    );
    try {
      // Persist the failure reason on the campaign row so the polling UI
      // ("/api/campaigns/active" → CampaignProgressMonitor) can show the
      // user *why* their send died, instead of letting them believe the
      // green-tick toast meant success.
      await service
        .from("campaigns")
        .update({
          status: "failed",
          last_error: message.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
    } catch {
      /* ignore */
    }
  });

  return NextResponse.json({ ok: true, mode: "started" as const });
}
