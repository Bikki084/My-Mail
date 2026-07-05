import IORedis from "ioredis";

const EMAIL_QUEUE_NAME = "email-campaign";

/** Redis key the worker refreshes every 30s (see scripts/email-worker.ts). */
export const WORKER_HEARTBEAT_KEY = "mymail:email-worker:heartbeat";

/** BullMQ worker Redis connection names include `:w:` (see Worker constructor). */
function queueNameBase64(name: string): string {
  return Buffer.from(name, "utf8").toString("base64");
}

async function probeHeartbeat(redisUrl: string, timeoutMs: number): Promise<boolean> {
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: Math.max(250, timeoutMs),
    commandTimeout: Math.max(250, timeoutMs),
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});
  const budget = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("HEARTBEAT_PROBE_TIMEOUT")), timeoutMs),
  );
  try {
    await Promise.race([redis.connect(), budget]);
    const raw = await Promise.race([redis.get(WORKER_HEARTBEAT_KEY), budget]);
    return raw != null && String(raw).length > 0;
  } catch {
    return false;
  } finally {
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
  }
}

async function probeClientList(redisUrl: string, timeoutMs: number): Promise<boolean> {
  const marker = `bull:${queueNameBase64(EMAIL_QUEUE_NAME)}`;
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: Math.max(250, timeoutMs),
    commandTimeout: Math.max(250, timeoutMs),
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on("error", () => {});
  const budget = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("WORKER_PROBE_TIMEOUT")), timeoutMs),
  );
  try {
    await Promise.race([redis.connect(), budget]);
    const raw = await Promise.race([
      redis.call("CLIENT", "LIST") as Promise<string>,
      budget,
    ]);
    const list = typeof raw === "string" ? raw : String(raw ?? "");
    return list
      .split("\n")
      .some((line) => line.includes(marker) && line.includes(":w:"));
  } catch {
    return false;
  } finally {
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Returns true if the email worker is running (heartbeat key or BullMQ client list).
 */
export async function hasRegisteredEmailWorker(
  redisUrl: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  if (await probeHeartbeat(redisUrl, timeoutMs)) return true;
  return probeClientList(redisUrl, timeoutMs);
}
