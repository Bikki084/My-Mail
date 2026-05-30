import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runSendCampaign } from "@/lib/campaign-delivery";
import { createServiceClient } from "@/lib/supabase/admin";
import { resolveCampaignSendMode } from "@/lib/queue/send-mode";
import { requireActivePlanForMailOrJson } from "@/lib/active-plan-guard";
import { getOrCreateOutboundIp } from "@/lib/outbound-ip";

/** Same recipient cap the original send route uses for in-process delivery. */
const MAX_SYNC_RECIPIENTS = 200;
type Params = { params: Promise<{ id: string }> };

/**
 * Resume a campaign that was paused mid-send for IP rotation. The flow is:
 *
 *   1. Verify the user owns the campaign and that it really is paused.
 *   2. Confirm the user's current outbound IP differs from the one the
 *      campaign was paused on — the UI rotates the IP just before calling
 *      this endpoint, so this guard catches double-clicks / stale tabs.
 *   3. Re-queue the campaign (BullMQ if Redis is up) or re-run delivery
 *      in-process. `runSendCampaign` is fully resumable — already-sent
 *      recipients are detected via `sending_logs` and skipped.
 */
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
    .select(
      "id, user_id, status, pause_reason, current_outbound_ip, total_emails, sent_count",
    )
    .eq("id", campaignId)
    .single();
  if (cErr || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (campaign.status !== "paused") {
    return NextResponse.json(
      { error: `Campaign is ${campaign.status}, not paused — nothing to resume.` },
      { status: 409 },
    );
  }

  const ipState = await getOrCreateOutboundIp(supabase, user.id);
  const pausedIp = (campaign.current_outbound_ip ?? "").trim();
  if (pausedIp && pausedIp === ipState.ip) {
    return NextResponse.json(
      {
        error:
          "Outbound IP has not changed yet. Click Refresh on the Server & outbound IP panel and try again.",
      },
      { status: 409 },
    );
  }

  const remaining =
    Math.max(0, (campaign.total_emails ?? 0) - (campaign.sent_count ?? 0));

  const sendMode = await resolveCampaignSendMode(remaining, MAX_SYNC_RECIPIENTS);

  if (sendMode.mode === "blocked") {
    return NextResponse.json({ error: sendMode.message }, { status: 503 });
  }

  if (sendMode.mode === "queue") {
    const queue = sendMode.queue;
    const { error: upErr } = await supabase
      .from("campaigns")
      .update({
        status: "queued",
        pause_reason: null,
        paused_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
    if (upErr) {
      return NextResponse.json(
        { error: `Could not mark campaign queued: ${upErr.message}` },
        { status: 500 },
      );
    }
    try {
      await queue.add(
        "send-campaign",
        { campaignId, userId: user.id },
        { removeOnComplete: true },
      );
    } catch (e) {
      // Roll back to paused so the user can retry without losing state.
      await supabase
        .from("campaigns")
        .update({
          status: "paused",
          pause_reason: "rotate_ip",
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
      const detail = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `Could not enqueue resume job: ${detail}` },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, mode: "queued" as const });
  }

  if (remaining > MAX_SYNC_RECIPIENTS) {
    return NextResponse.json(
      {
        error:
          `Resume needs to deliver ${remaining} more emails (max ${MAX_SYNC_RECIPIENTS} in-process). ` +
          "Start Redis and the email worker, then retry.",
      },
      { status: 503 },
    );
  }

  // Flip back to `sending` first so the polling UI sees state change quickly,
  // then run the loop without awaiting (same pattern as the initial send).
  const service = createServiceClient();
  const { error: markErr } = await service
    .from("campaigns")
    .update({
      status: "sending",
      pause_reason: null,
      paused_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  if (markErr) {
    return NextResponse.json(
      { error: `Could not mark campaign sending: ${markErr.message}` },
      { status: 500 },
    );
  }
  void runSendCampaign(service, campaignId, user.id).catch(async (e) => {
    const message = e instanceof Error ? e.message : "Resume failed";
    console.error(
      `[api/campaigns/resume] background delivery failed for ${campaignId}:`,
      message,
    );
    try {
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
