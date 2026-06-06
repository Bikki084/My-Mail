import { parsePositiveIntEnv } from "@/lib/async-pool";

/** Max recipients delivered in-process when Redis/worker is unavailable. */
export function maxSyncCampaignRecipients(): number {
  return parsePositiveIntEnv("MAX_SYNC_RECIPIENTS", 5000);
}
