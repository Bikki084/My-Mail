import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markCampaignFailed, runSendCampaign } from "@/lib/campaign-delivery";
import { runSendPreflight } from "@/lib/campaign-send-preflight";
import { createServiceClient } from "@/lib/supabase/admin";
import { resolveCampaignSendMode } from "@/lib/queue/send-mode";
import {
  requireActivePlanForMailOrJson,
  hasNonExpiredActivePlan,
} from "@/lib/active-plan-guard";
import { maxSyncCampaignRecipients } from "@/lib/campaign-sync-limits";
import { redisCircuit } from "@/lib/circuit-breaker";

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

  if (campaign.status === "cancelled") {
    return NextResponse.json(
      { error: "This campaign was cancelled and cannot be sent again." },
      { status: 409 },
    );
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

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server configuration error";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  const preflight = await runSendPreflight(service, user.id);
  if (!preflight.ok) {
    return NextResponse.json({ error: preflight.error }, { status: preflight.status });
  }

  const maxSyncRecipients = maxSyncCampaignRecipients();
  const sendMode = await resolveCampaignSendMode(need, maxSyncRecipients);

  if (sendMode.mode === "blocked") {
    return NextResponse.json({ error: sendMode.message }, { status: 503 });
  }

  if (sendMode.mode === "queue") {
    const queue = sendMode.queue;
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
      await redisCircuit.execute(
        () =>
          Promise.race([
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
          ]),
        { timeoutMs: QUEUE_ADD_MS },
      );
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

  if (need > maxSyncRecipients) {
    return NextResponse.json(
      {
        error:
          `This campaign has ${need} recipients. For more than ${maxSyncRecipients}, ` +
          "set REDIS_URL, start Redis, and run the email worker (`npm run worker` or PM2 mymail-worker).",
      },
      { status: 503 },
    );
  }

  /**
   * Mark the campaign as `sending` synchronously so the Sending & Logs tab
   * sees state change immediately, then run delivery via `after()` so Next.js
   * keeps the task alive after the HTTP response (plain `void` can be dropped).
   * Lightsail egress attach/detach is handled inside runSendCampaign.
   */
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

  const runInBackground = () => {
    runSendCampaign(service, campaignId, user.id).catch(async (e) => {
      const message = e instanceof Error ? e.message : "Delivery failed";
      console.error(
        `[api/campaigns/send] background delivery failed for ${campaignId}:`,
        message,
      );
      try {
        await markCampaignFailed(service, campaignId, message);
      } catch {
        /* ignore */
      }
    });
  };

  // PM2/VPS: fire-and-forget is more reliable than `after()` for long SMTP runs.
  if (process.env.CAMPAIGN_DELIVERY_USE_AFTER === "1") {
    after(runInBackground);
  } else {
    void runInBackground();
  }

  return NextResponse.json({ ok: true, mode: "started" as const });
}
