import "server-only";

import IORedis from "ioredis";
import { parsePositiveIntEnv } from "@/lib/async-pool";
import { isRedisCircuitOpen } from "@/lib/circuit-breaker";
import {
  ensureLightsailEgressIpForSend,
  ensureLightsailPrimaryStaticIpAttached,
  fetchLightsailPoolIpv4List,
  isAwsLightsailRotationConfigured,
  withLightsailEgressLock,
} from "@/lib/aws-outbound-ip";
import { usesLightsailSendEgress } from "@/lib/egress-mode";

const REDIS_PREFIX = "mymail:send-governor:";

/**
 * Max campaigns actively sending on this VPS at once.
 * There is no cap on queued campaigns — 100+ users all enqueue; excess waits here.
 * Raise on a larger VPS (e.g. 10–12); lower (e.g. 4) if the site slows during sends.
 */
export function maxConcurrentCampaigns(): number {
  return parsePositiveIntEnv("EMAIL_CAMPAIGN_CONCURRENCY", 6);
}

/** Max in-flight SMTP operations across all campaigns on this server. */
export function maxGlobalSmtpConcurrency(): number {
  return parsePositiveIntEnv("GLOBAL_SMTP_CONCURRENCY", 36);
}

/** Rotate shared Lightsail egress after this many successful sends (all users). */
export function globalEgressRotationBurst(): number {
  return parsePositiveIntEnv("GLOBAL_EGRESS_ROTATION_BURST", 200);
}

export function isSendGovernorEnabled(): boolean {
  return process.env.SEND_GOVERNOR_DISABLE !== "1";
}

let redis: IORedis | null = null;

function shouldUseRedisGovernor(): boolean {
  return Boolean(process.env.REDIS_URL?.trim()) && !isRedisCircuitOpen();
}

function getRedis(): IORedis | null {
  if (!shouldUseRedisGovernor()) return null;
  const url = process.env.REDIS_URL!.trim();
  if (!redis) {
    redis = new IORedis(url, {
      maxRetriesPerRequest: 3,
      connectTimeout: 8_000,
      commandTimeout: 8_000,
      lazyConnect: true,
    });
    redis.on("error", () => {});
  }
  return redis;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** In-process fallback when Redis is unavailable (single Node process). */
const local = {
  activeCampaigns: 0,
  smtpInflight: 0,
  globalSendSuccess: 0,
  sharedEgressIndex: 0,
  sharedEgressIps: [] as string[],
};

async function ensureSharedEgressPool(): Promise<string[]> {
  if (local.sharedEgressIps.length >= 2) return local.sharedEgressIps;
  if (isAwsLightsailRotationConfigured()) {
    try {
      local.sharedEgressIps = await fetchLightsailPoolIpv4List();
    } catch {
      local.sharedEgressIps = [];
    }
  }
  return local.sharedEgressIps;
}

async function redisIncr(key: string, by = 1): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    if (r.status !== "ready") await r.connect();
    return await r.incrby(key, by);
  } catch {
    return 0;
  }
}

async function redisDecr(key: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    if (r.status !== "ready") await r.connect();
    const n = await r.decr(key);
    if (n < 0) {
      await r.set(key, "0");
      return 0;
    }
    return n;
  } catch {
    return 0;
  }
}

async function redisGetInt(key: string): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    if (r.status !== "ready") await r.connect();
    const raw = await r.get(key);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null;
  }
}

/**
 * Wait for a campaign delivery slot. Queues excess campaigns instead of
 * opening hundreds of parallel SMTP connections on one Ubuntu instance.
 */
export async function acquireCampaignDeliverySlot(campaignId: string): Promise<void> {
  if (!isSendGovernorEnabled()) return;

  const limit = maxConcurrentCampaigns();
  const waitLogMs = 15_000;
  let waitedMs = 0;

  for (;;) {
    const r = getRedis();
    if (r) {
      const n = await redisIncr(`${REDIS_PREFIX}campaigns:active`);
      if (n <= limit) {
        console.log(
          `[send-governor] campaign=${campaignId} slot ${n}/${limit}`,
        );
        return;
      }
      await redisDecr(`${REDIS_PREFIX}campaigns:active`);
    } else {
      if (local.activeCampaigns < limit) {
        local.activeCampaigns += 1;
        console.log(
          `[send-governor] campaign=${campaignId} slot ${local.activeCampaigns}/${limit} (local)`,
        );
        return;
      }
    }

    if (waitedMs === 0 || waitedMs % waitLogMs === 0) {
      console.log(
        `[send-governor] campaign=${campaignId} waiting for slot (${limit} max concurrent campaigns)…`,
      );
    }
    await sleep(400);
    waitedMs += 400;
  }
}

/** Release campaign slot; restore website primary IP when the last campaign finishes. */
export async function releaseCampaignDeliverySlot(campaignId: string): Promise<void> {
  if (!isSendGovernorEnabled()) return;

  const r = getRedis();
  if (r) {
    const remaining = await redisDecr(`${REDIS_PREFIX}campaigns:active`);
    console.log(
      `[send-governor] campaign=${campaignId} released slot (${Math.max(0, remaining)} active)`,
    );
    if (remaining <= 0 && usesLightsailSendEgress()) {
      await withLightsailEgressLock(async () => {
        await ensureLightsailPrimaryStaticIpAttached();
      });
      console.log("[send-governor] all campaigns idle — website primary IP restored");
    }
    return;
  }

  local.activeCampaigns = Math.max(0, local.activeCampaigns - 1);
  console.log(
    `[send-governor] campaign=${campaignId} released slot (${local.activeCampaigns} active, local)`,
  );
  if (local.activeCampaigns === 0 && usesLightsailSendEgress()) {
    await withLightsailEgressLock(async () => {
      await ensureLightsailPrimaryStaticIpAttached();
    });
    console.log("[send-governor] all campaigns idle — website primary IP restored (local)");
  }
}

/** Limit total parallel SMTP sends so the VPS stays responsive under load. */
export async function withGlobalSmtpSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (!isSendGovernorEnabled()) return fn();

  const limit = maxGlobalSmtpConcurrency();
  for (;;) {
    const r = getRedis();
    if (r) {
      const n = await redisIncr(`${REDIS_PREFIX}smtp:inflight`);
      if (n <= limit) {
        try {
          return await fn();
        } finally {
          await redisDecr(`${REDIS_PREFIX}smtp:inflight`);
        }
      }
      await redisDecr(`${REDIS_PREFIX}smtp:inflight`);
    } else {
      if (local.smtpInflight < limit) {
        local.smtpInflight += 1;
        try {
          return await fn();
        } finally {
          local.smtpInflight = Math.max(0, local.smtpInflight - 1);
        }
      }
    }
    await sleep(25);
  }
}

/**
 * After a successful send, maybe rotate the shared Lightsail egress IP through
 * the 5 static IPs (serialized — safe for one Ubuntu instance).
 */
export async function recordGlobalSuccessfulSend(): Promise<{
  rotated: boolean;
  ip: string | null;
}> {
  if (!isSendGovernorEnabled() || !usesLightsailSendEgress()) {
    return { rotated: false, ip: null };
  }

  const burst = globalEgressRotationBurst();
  const r = getRedis();
  let count: number;

  if (r) {
    count = await redisIncr(`${REDIS_PREFIX}egress:send-success`);
  } else {
    local.globalSendSuccess += 1;
    count = local.globalSendSuccess;
  }

  if (count % burst !== 0) {
    return { rotated: false, ip: null };
  }

  const pool = await ensureSharedEgressPool();
  if (pool.length < 2) {
    return { rotated: false, ip: null };
  }

  let nextIndex: number;
  if (r) {
    const idx = await redisIncr(`${REDIS_PREFIX}egress:index`);
    nextIndex = (idx - 1) % pool.length;
  } else {
    nextIndex = local.sharedEgressIndex % pool.length;
    local.sharedEgressIndex = (local.sharedEgressIndex + 1) % pool.length;
  }

  const nextIp = pool[nextIndex]!;
  await withLightsailEgressLock(async () => {
    await ensureLightsailEgressIpForSend(nextIp);
  });
  console.log(
    `[send-governor] shared egress rotated to ${nextIp} after ${count} global sends (pool ${pool.length} IPs)`,
  );
  return { rotated: true, ip: nextIp };
}

/** Attach the first send IP when a campaign starts (if send egress mode is on). */
export async function prepareSharedSendEgress(sendIp: string): Promise<void> {
  if (!usesLightsailSendEgress()) return;
  const wanted = sendIp.trim();
  if (!wanted) return;
  await withLightsailEgressLock(async () => {
    await ensureLightsailEgressIpForSend(wanted);
  });
}

/** Active campaign count (for diagnostics). */
export async function activeCampaignCount(): Promise<number> {
  const fromRedis = await redisGetInt(`${REDIS_PREFIX}campaigns:active`);
  if (fromRedis != null) return fromRedis;
  return local.activeCampaigns;
}
