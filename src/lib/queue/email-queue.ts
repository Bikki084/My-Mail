import { Queue } from "bullmq";
import IORedis from "ioredis";
import { redisCircuit } from "@/lib/circuit-breaker";

export type EmailJobPayload = {
  campaignId: string;
  userId: string;
};

/** Producer connection: tight timeouts so /api/campaigns/:id/send never hangs forever on bad REDIS_URL. */
function createQueueConnection(url: string): IORedis {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 12_000,
    commandTimeout: 12_000,
  });
}

let connection: IORedis | null = null;
let queue: Queue<EmailJobPayload> | null = null;

function getConnection(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!connection) {
    connection = createQueueConnection(url);
  }
  return connection;
}

export function getEmailQueue(): Queue<EmailJobPayload> | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!queue) {
    queue = new Queue<EmailJobPayload>("email-campaign", { connection: conn });
  }
  return queue;
}

export function isQueueConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

/**
 * Drop any cached queue + connection (best-effort). Call after we detect Redis
 * is unreachable so the *next* request creates a fresh connection — e.g. once
 * the user starts their Redis container — instead of reusing one stuck in
 * permanent reconnect.
 */
export async function disposeEmailQueue(): Promise<void> {
  const q = queue;
  const c = connection;
  queue = null;
  connection = null;
  probeCache = null;
  try {
    if (q) await q.close();
  } catch {
    /* ignore */
  }
  try {
    c?.disconnect();
  } catch {
    /* ignore */
  }
}

/**
 * Cache the probe result for a short window so successive /send calls don't
 * each pay the connect-timeout cost (typical case: user clicks Send, Redis is
 * down, we want subsequent clicks to short-circuit instead of stalling 1.5s).
 * Cache is short enough that a freshly-started Redis is detected on the next
 * send (≤ a few seconds later).
 */
const PROBE_CACHE_MS = 5_000;
type ProbeCacheEntry = { value: boolean; expiresAt: number; url: string };
let probeCache: ProbeCacheEntry | null = null;
let inflightProbe: Promise<boolean> | null = null;

/**
 * Reachability probe with a short hard budget. Uses a throwaway connection
 * with `lazyConnect` + `retryStrategy: () => null` so an unreachable Redis
 * fails fast (no retry storm) and never poisons the long-lived BullMQ
 * connection. Result is cached for a few seconds to keep send latency low.
 */
export async function pingRedis(timeoutMs = 1_500): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;

  const now = Date.now();
  if (probeCache && probeCache.url === url && probeCache.expiresAt > now) {
    return probeCache.value;
  }
  if (inflightProbe) return inflightProbe;

  inflightProbe = (async () => {
    if (redisCircuit.isOpen()) {
      probeCache = { value: false, expiresAt: Date.now() + PROBE_CACHE_MS, url };
      return false;
    }

    const probe = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: Math.max(250, timeoutMs),
      commandTimeout: Math.max(250, timeoutMs),
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    // Swallow the error event so an unreachable Redis doesn't crash the request.
    probe.on("error", () => {});
    const budget = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("REDIS_PROBE_TIMEOUT")), timeoutMs),
    );
    let result = false;
    try {
      await Promise.race([probe.connect(), budget]);
      const pong = await Promise.race([probe.ping(), budget]);
      result = typeof pong === "string" && pong.toUpperCase() === "PONG";
    } catch {
      result = false;
    } finally {
      try {
        probe.disconnect();
      } catch {
        /* ignore */
      }
    }
    probeCache = { value: result, expiresAt: Date.now() + PROBE_CACHE_MS, url };
    if (result) {
      redisCircuit.recordExternalSuccess();
    } else {
      redisCircuit.recordExternalFailure();
    }
    return result;
  })().finally(() => {
    inflightProbe = null;
  });

  return inflightProbe;
}

/** Forget the cached probe result (e.g. after a queue add fails so the next request reprobes). */
export function invalidateRedisProbeCache(): void {
  probeCache = null;
}
