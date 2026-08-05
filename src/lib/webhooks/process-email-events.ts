import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseGenericEvents,
  parseSendGridEvents,
  shouldAutoSuppress,
  suppressionSourceFromEvent,
  type NormalizedEmailEvent,
} from "@/lib/webhooks/email-events";
import { addSuppression } from "@/lib/recipient-suppression";
import {
  mapWebhookEventToSignal,
  pauseActiveCampaignsForDeliverabilityGuard,
  recordDeliverabilitySignal,
} from "@/lib/deliverability-guard";

export type ProcessEmailEventsResult = {
  processed: number;
  suppressed: number;
  skipped: number;
};

async function resolveUserIdFromLogs(
  supabase: SupabaseClient,
  email: string,
  campaignId: string | null,
): Promise<string | null> {
  if (campaignId) {
    const { data: camp } = await supabase
      .from("campaigns")
      .select("user_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (camp?.user_id) return String(camp.user_id);
  }

  const { data: logRow } = await supabase
    .from("sending_logs")
    .select("user_id, campaign_id")
    .eq("recipient_email", email)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (logRow?.user_id) return String(logRow.user_id);
  return null;
}

async function markSendingLogBounced(
  supabase: SupabaseClient,
  email: string,
  campaignId: string | null,
  note: string,
): Promise<void> {
  let q = supabase
    .from("sending_logs")
    .update({
      status: "bounced",
      error_message: note.slice(0, 2000),
    })
    .eq("recipient_email", email)
    .eq("status", "sent");

  if (campaignId) {
    q = q.eq("campaign_id", campaignId);
  }

  await q;
}

async function auditEvent(
  supabase: SupabaseClient,
  event: NormalizedEmailEvent,
  userId: string | null,
): Promise<void> {
  try {
    await supabase.from("email_webhook_events").insert({
      provider: event.provider,
      event_type: event.eventType,
      recipient_email: event.recipientEmail,
      user_id: userId,
      campaign_id: event.campaignId,
      raw: event.raw,
    });
  } catch {
    // Audit is best-effort.
  }
}

export async function processInboundEmailEvents(
  supabase: SupabaseClient,
  events: NormalizedEmailEvent[],
): Promise<ProcessEmailEventsResult> {
  let processed = 0;
  let suppressed = 0;
  let skipped = 0;

  for (const event of events) {
    processed += 1;

    let userId = event.userId;
    if (!userId) {
      userId = await resolveUserIdFromLogs(
        supabase,
        event.recipientEmail,
        event.campaignId,
      );
    }

    await auditEvent(supabase, event, userId);

    const guardSignal = mapWebhookEventToSignal(event.eventType);
    if (guardSignal) {
      const trip = await recordDeliverabilitySignal(guardSignal, {
        userId,
        campaignId: event.campaignId,
        detail: `${event.provider}:${event.eventType}:${event.recipientEmail}`,
      });
      if (trip.paused && trip.reason) {
        await pauseActiveCampaignsForDeliverabilityGuard(supabase, trip.reason);
      }
    }

    if (!shouldAutoSuppress(event.eventType)) {
      skipped += 1;
      continue;
    }

    if (!userId) {
      skipped += 1;
      continue;
    }

    const source = suppressionSourceFromEvent(event.eventType);
    const note = `${event.provider}:${event.eventType}`;
    const result = await addSuppression(supabase, {
      userId,
      recipientEmail: event.recipientEmail,
      source,
      campaignId: event.campaignId,
      note,
    });

    if (result.ok) {
      suppressed += 1;
      await markSendingLogBounced(
        supabase,
        event.recipientEmail,
        event.campaignId,
        note,
      );
    } else {
      skipped += 1;
    }
  }

  return { processed, suppressed, skipped };
}

export function parseInboundEmailEvents(
  body: unknown,
  providerHint: string | null,
): NormalizedEmailEvent[] {
  const hint = (providerHint ?? "").trim().toLowerCase();
  if (hint === "sendgrid" || (!hint && Array.isArray(body))) {
    const sg = parseSendGridEvents(body);
    if (sg.length > 0) return sg;
  }
  return parseGenericEvents(body, hint || "generic");
}
