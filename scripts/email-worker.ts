/**
 * BullMQ worker: processes `send-campaign` jobs (same delivery as API sync path).
 * Run: `npm run worker` (requires REDIS_URL, Supabase service role, SMTP_ENCRYPTION_KEY).
 * Local dev: `npm run dev` starts this automatically when REDIS_URL is set in `.env.local`.
 */
import "./worker-preload.cjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { parsePositiveIntEnv } from "../src/lib/async-pool";
import { createServiceClient } from "../src/lib/supabase/admin";
import { markCampaignFailed, runSendCampaign } from "../src/lib/campaign-delivery";
import type { EmailJobPayload } from "../src/lib/queue/email-queue";
import { WORKER_HEARTBEAT_KEY } from "../src/lib/queue/worker-presence";

const require = createRequire(import.meta.url);

function loadEnvFromProjectFiles() {
  for (const name of [".env.local", ".env"]) {
    const p = join(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] == null) process.env[m[1]] = v;
    }
  }
}

function friendlyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function autoMigrateOnStartup(): Promise<void> {
  try {
    const { applyPendingMigrations } = require("./lib/migrate-runner.cjs") as {
      applyPendingMigrations: (opts?: { cwd?: string }) => Promise<{
        ok: boolean;
        mode?: string;
        reason?: string;
        applied?: string[];
      }>;
    };
    const result = await applyPendingMigrations({ cwd: process.cwd() });
    if (result.mode === "skipped") {
      console.warn(`[email-worker] ${result.reason}`);
    } else if (!result.ok) {
      console.warn(`[email-worker] Auto-migrate: ${result.reason}`);
    } else if (result.applied?.length) {
      console.log(
        `[email-worker] Auto-applied migrations: ${result.applied.join(", ")}`,
      );
    }
  } catch (e) {
    console.warn(`[email-worker] Auto-migrate threw: ${friendlyErr(e)}`);
  }
}

async function main(): Promise<void> {
  loadEnvFromProjectFiles();

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("REDIS_URL is required");
    process.exit(1);
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.error(
      "[email-worker] SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local in the project root (Settings → API → service_role in Supabase). The worker needs it to read campaigns and SMTP.",
    );
    process.exit(1);
  }
  if (!process.env.SMTP_ENCRYPTION_KEY?.trim()) {
    console.error(
      "[email-worker] SMTP_ENCRYPTION_KEY is missing. It must match the key used when saving SMTP passwords. Add to .env.local.",
    );
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    console.error("[email-worker] NEXT_PUBLIC_SUPABASE_URL is missing. Add to .env.local.");
    process.exit(1);
  }

  await autoMigrateOnStartup();

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 15_000,
  });

  const workerConcurrency = parsePositiveIntEnv("EMAIL_WORKER_CONCURRENCY", 6);
  const HEARTBEAT_TTL_SEC = 90;

  async function pulseHeartbeat(): Promise<void> {
    try {
      await connection.set(
        WORKER_HEARTBEAT_KEY,
        String(Date.now()),
        "EX",
        HEARTBEAT_TTL_SEC,
      );
    } catch (e) {
      console.warn(
        `[email-worker] heartbeat failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const worker = new Worker<EmailJobPayload>(
    "email-campaign",
    async (job) => {
      if (job.name !== "send-campaign") {
        console.warn(
          `[email-worker] skip unknown job name ${JSON.stringify(job.name)}`,
        );
        return;
      }
      const { campaignId, userId } = job.data;
      console.log(
        `[email-worker] job ${job.id} send-campaign campaign=${campaignId} user=${userId}`,
      );
      const supabase = createServiceClient();
      try {
        await runSendCampaign(supabase, campaignId, userId);
      } catch (e) {
        const msg = friendlyErr(e);
        console.error(`[email-worker] ${msg}`);
        await markCampaignFailed(supabase, campaignId, msg);
        throw e;
      }
    },
    { connection, concurrency: workerConcurrency },
  );

  console.log(
    `[email-worker] listening on email-campaign (concurrency=${workerConcurrency})`,
  );

  await pulseHeartbeat();
  const heartbeatTimer = setInterval(() => {
    void pulseHeartbeat();
  }, 30_000);
  heartbeatTimer.unref?.();

  worker.on("ready", () => {
    void pulseHeartbeat();
  });

  worker.on("failed", (job, err) => {
    console.error(`[email-worker] job ${job?.id} failed`, err);
  });

  process.on("SIGINT", async () => {
    clearInterval(heartbeatTimer);
    try {
      await connection.del(WORKER_HEARTBEAT_KEY);
    } catch {
      /* ignore */
    }
    await worker.close();
    await connection.quit();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[email-worker] fatal:", friendlyErr(e));
  process.exit(1);
});
