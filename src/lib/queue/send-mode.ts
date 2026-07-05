import {
  disposeEmailQueue,
  getEmailQueue,
  isQueueConfigured,
  pingRedis,
} from "@/lib/queue/email-queue";
import type { EmailJobPayload } from "@/lib/queue/email-queue";
import { hasRegisteredEmailWorker } from "@/lib/queue/worker-presence";
import type { Queue } from "bullmq";

const REDIS_PROBE_MS = 2_500;
const WORKER_PROBE_MS = 3_000;
const WORKER_PROBE_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeWorkerWithRetries(redisUrl: string): Promise<boolean> {
  for (let attempt = 0; attempt < WORKER_PROBE_RETRIES; attempt += 1) {
    if (await hasRegisteredEmailWorker(redisUrl, WORKER_PROBE_MS)) return true;
    if (attempt < WORKER_PROBE_RETRIES - 1) {
      await sleep(600);
    }
  }
  return false;
}

export type ResolvedSendMode =
  | { mode: "queue"; queue: Queue<EmailJobPayload> }
  | {
      mode: "sync";
      /** REDIS_URL was set (queue intended) but delivery runs in the web process. */
      queueConfigured: boolean;
      workerMissing: boolean;
    }
  | {
      mode: "blocked";
      queueConfigured: boolean;
      message: string;
    };

/**
 * Prefer BullMQ when Redis is up and a worker is connected. If REDIS_URL is set
 * but no worker is registered (common on VPS when only `mymail-web` runs in PM2),
 * fall back to in-process delivery for campaigns within the sync recipient cap.
 */
export async function resolveCampaignSendMode(
  recipientCount: number,
  maxSyncRecipients: number,
): Promise<ResolvedSendMode> {
  const wantQueue = isQueueConfigured();
  if (!wantQueue) {
    return { mode: "sync", queueConfigured: false, workerMissing: false };
  }

  const redisUrl = process.env.REDIS_URL!.trim();
  const queueLive = await pingRedis(REDIS_PROBE_MS);
  if (!queueLive) {
    console.warn(
      "[send-mode] REDIS_URL is set but Redis is not reachable; using in-process delivery.",
    );
    await disposeEmailQueue();
    if (recipientCount > maxSyncRecipients) {
      return {
        mode: "blocked",
        queueConfigured: true,
        message:
          `REDIS_URL is set but Redis is not reachable. This send has ${recipientCount} recipients ` +
          `(max ${maxSyncRecipients} without the queue). Start Redis, then run \`npm run worker\`, and try again.`,
      };
    }
    return { mode: "sync", queueConfigured: true, workerMissing: false };
  }

  const workerUp = await probeWorkerWithRetries(redisUrl);

  if (!workerUp) {
    // Small campaigns always send (governor throttles load) — never block 24–5000 recipients.
    if (recipientCount <= maxSyncRecipients) {
      console.warn(
        "[send-mode] Worker heartbeat not detected — using in-process delivery for " +
          `${recipientCount} recipient(s). Run: bash scripts/ensure-email-stack.sh`,
      );
      await disposeEmailQueue();
      return { mode: "sync", queueConfigured: true, workerMissing: true };
    }
    return {
      mode: "blocked",
      queueConfigured: true,
      message:
        `This campaign has ${recipientCount} recipients and needs the email worker. ` +
        `On the server run: cd ~/mymail && git pull && npm run build:prod && bash scripts/ensure-email-stack.sh`,
    };
  }

  const queue = getEmailQueue();
  if (!queue) {
    return { mode: "sync", queueConfigured: false, workerMissing: false };
  }
  return { mode: "queue", queue };
}
