import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCampaignBouncePauseMessage } from "@/lib/campaign-bounce-guard-logic";
import { freezeAllSendingForReputation } from "@/lib/deliverability-guard";
import { evaluateAndUpdateTrustTier } from "@/lib/trust-tier/service";

export {
  formatCampaignBouncePauseMessage,
  shouldPauseCampaignForBounceSpike,
} from "@/lib/campaign-bounce-guard-logic";

export async function pauseCampaignForBounceSpike(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string,
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("campaigns")
    .update({
      status: "paused",
      pause_reason: "bounce_spike",
      paused_at: now,
      last_error: message,
      updated_at: now,
    })
    .eq("id", campaignId);

  await freezeAllSendingForReputation(
    supabase,
    `Hard bounce spike detected — ${message}`,
  );

  void evaluateAndUpdateTrustTier(supabase, userId);

  console.error(
    `[campaign-bounce-guard] campaign=${campaignId} user=${userId} paused — ${message}`,
  );
}
