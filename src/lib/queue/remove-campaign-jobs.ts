import { getEmailQueue } from "@/lib/queue/email-queue";
import type { EmailJobPayload } from "@/lib/queue/email-queue";

const QUEUE_JOB_STATES = ["waiting", "delayed", "active", "paused"] as const;

/**
 * Best-effort removal of BullMQ `send-campaign` jobs for the given campaigns.
 * Active jobs may still run briefly until the worker observes `status=cancelled`.
 */
export async function removeCampaignJobsFromQueue(
  campaignIds: string[],
): Promise<number> {
  const queue = getEmailQueue();
  if (!queue || campaignIds.length === 0) return 0;

  const targets = new Set(campaignIds);
  let removed = 0;

  for (const state of QUEUE_JOB_STATES) {
    let jobs;
    try {
      jobs = await queue.getJobs(state, 0, 500);
    } catch (e) {
      console.warn(`[queue] getJobs(${state}) failed:`, e);
      continue;
    }

    for (const job of jobs) {
      if (job.name !== "send-campaign") continue;
      const data = job.data as EmailJobPayload | undefined;
      if (!data?.campaignId || !targets.has(data.campaignId)) continue;
      try {
        await job.remove();
        removed += 1;
      } catch (e) {
        console.warn(
          `[queue] could not remove job ${job.id} campaign=${data.campaignId}:`,
          e,
        );
      }
    }
  }

  if (removed > 0) {
    console.log(`[queue] removed ${removed} job(s) for cancelled campaign(s)`);
  }

  return removed;
}
