import "server-only";

import IORedis from "ioredis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePositiveIntEnv } from "@/lib/async-pool";
import { isRedisCircuitOpen } from "@/lib/circuit-breaker";
import type { DeliverabilitySignal } from "@/lib/deliverability-guard-types";
import {
  classifySmtpErrorForGuard,
  computeCompositeScore,
  compositePauseThreshold,
  formatPlatformFreezeReason,
  mapWebhookEventToSignal,
  perSignalThresholds,
  shouldTripCompositePause,
} from "@/lib/deliverability-guard-logic";

export type { DeliverabilitySignal } from "@/lib/deliverability-guard-types";
export { classifySmtpErrorForGuard, mapWebhookEventToSignal };

/**
 * Platform-wide send pause when reputation signals spike (spam reports, blocks,
 * bounces, SMTP spam rejects, ESP account warnings). Freezes all sending for
 * DELIVERABILITY_PAUSE_HOURS (default 7) before the ESP suspends the account.
 */

export type DeliverabilityPauseStatus = {
  paused: boolean;
  pausedUntil: string | null;
  reason: string | null;
  remainingMs: number;
};

const REDIS_PREFIX = "mymail:deliverability:";
const PAUSED_UNTIL_KEY = `${REDIS_PREFIX}paused_until`;
const PAUSE_REASON_KEY = `${REDIS_PREFIX}pause_reason`;

function countKey(signal: DeliverabilitySignal): string {
  return `${REDIS_PREFIX}count:${signal}`;
}

const localEvents: { ts: number; signal: DeliverabilitySignal }[] = [];
let localPausedUntil = 0;
let localPauseReason: string | null = null;

function pauseHours(): number {
  const h = parsePositiveIntEnv("DELIVERABILITY_PAUSE_HOURS", 7);
  return Math.min(Math.max(h, 1), 48);
}

function guardEnabled(): boolean {
  return process.env.DELIVERABILITY_GUARD_DISABLE !== "1";
}

function windowMs(): number {
  return parsePositiveIntEnv("DELIVERABILITY_SIGNAL_WINDOW_MINUTES", 60) * 60_000;
}

let redis: IORedis | null = null;

function getRedis(): IORedis | null {
  if (!guardEnabled()) return null;
  const url = process.env.REDIS_URL?.trim();
  if (!url || isRedisCircuitOpen()) return null;
  if (!redis) {
    redis = new IORedis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
      commandTimeout: 5_000,
      lazyConnect: true,
    });
    redis.on("error", () => {});
  }
  return redis;
}

function pruneLocal(now: number): void {
  const cutoff = now - windowMs();
  while (localEvents.length > 0 && localEvents[0]!.ts < cutoff) {
    localEvents.shift();
  }
}

async function readPauseFromRedis(r: IORedis): Promise<{ until: number; reason: string | null }> {
  const [untilRaw, reason] = await r.mget(PAUSED_UNTIL_KEY, PAUSE_REASON_KEY);
  return {
    until: untilRaw ? parseInt(untilRaw, 10) || 0 : 0,
    reason: reason ?? null,
  };
}

export async function getDeliverabilityPauseStatus(): Promise<DeliverabilityPauseStatus> {
  if (!guardEnabled()) {
    return { paused: false, pausedUntil: null, reason: null, remainingMs: 0 };
  }

  const now = Date.now();
  let until = localPausedUntil;
  let reason = localPauseReason;

  const r = getRedis();
  if (r) {
    try {
      const remote = await readPauseFromRedis(r);
      if (remote.until > until) {
        until = remote.until;
        reason = remote.reason;
      }
    } catch {
      // fall back to local
    }
  }

  if (until <= now) {
    return { paused: false, pausedUntil: null, reason: null, remainingMs: 0 };
  }

  return {
    paused: true,
    pausedUntil: new Date(until).toISOString(),
    reason,
    remainingMs: until - now,
  };
}

export async function assertSendingAllowed(): Promise<
  { ok: true } | { ok: false; status: DeliverabilityPauseStatus }
> {
  const status = await getDeliverabilityPauseStatus();
  if (status.paused) return { ok: false, status };
  return { ok: true };
}

function countSignalsInWindow(
  events: { ts: number; signal: DeliverabilitySignal }[],
  now: number,
): Map<DeliverabilitySignal, number> {
  const cutoff = now - windowMs();
  const counts = new Map<DeliverabilitySignal, number>();
  for (const e of events) {
    if (e.ts < cutoff) continue;
    counts.set(e.signal, (counts.get(e.signal) ?? 0) + 1);
  }
  return counts;
}

async function readAllSignalCounts(
  now: number,
): Promise<Partial<Record<DeliverabilitySignal, number>>> {
  const r = getRedis();
  const out: Partial<Record<DeliverabilitySignal, number>> = {};
  const signals = Object.keys(perSignalThresholds()) as DeliverabilitySignal[];

  if (r) {
    try {
      const keys = signals.map((s) => countKey(s));
      const values = await r.mget(...keys);
      for (let i = 0; i < signals.length; i++) {
        const n = parseInt(values[i] ?? "0", 10);
        if (n > 0) out[signals[i]!] = n;
      }
      return out;
    } catch {
      // fall through to local
    }
  }

  const local = countSignalsInWindow(localEvents, now);
  for (const [signal, count] of local) {
    out[signal] = count;
  }
  return out;
}

async function activatePause(reason: string): Promise<void> {
  const until = Date.now() + pauseHours() * 60 * 60_000;
  localPausedUntil = until;
  localPauseReason = reason;

  const r = getRedis();
  if (r) {
    try {
      const ttlSec = pauseHours() * 3600 + 300;
      await r
        .multi()
        .set(PAUSED_UNTIL_KEY, String(until), "EX", ttlSec)
        .set(PAUSE_REASON_KEY, reason, "EX", ttlSec)
        .exec();
    } catch (e) {
      console.warn(
        `[deliverability-guard] failed to persist pause to Redis: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  console.error(
    `[deliverability-guard] ALL SENDS FROZEN ${pauseHours()}h until ${new Date(until).toISOString()} — ${reason}`,
  );
}

/**
 * Freeze all platform sending for DELIVERABILITY_PAUSE_HOURS and pause in-flight campaigns.
 * Call when reputation signals spike — before the ESP (SendGrid) suspends the account.
 */
export async function freezeAllSendingForReputation(
  supabase: SupabaseClient | null,
  reason: string,
): Promise<void> {
  if (!guardEnabled()) return;

  const existing = await getDeliverabilityPauseStatus();
  if (!existing.paused) {
    await activatePause(reason);
  }

  if (supabase) {
    await pauseActiveCampaignsForDeliverabilityGuard(supabase, reason);
  }
}

async function evaluateTripAfterSignal(
  signal: DeliverabilitySignal,
  count: number,
  now: number,
  meta?: { userId?: string | null; campaignId?: string | null; detail?: string },
): Promise<{ paused: boolean; reason?: string }> {
  const limits = perSignalThresholds();
  const limit = limits[signal];

  if (count >= limit) {
    const reason = formatPlatformFreezeReason({
      signal,
      count,
      limit,
      detail: meta?.detail,
    });
    return { paused: true, reason };
  }

  const allCounts = await readAllSignalCounts(now);
  const composite = computeCompositeScore(allCounts);
  if (shouldTripCompositePause(composite)) {
    const reason = formatPlatformFreezeReason({
      compositeScore: composite,
      compositeLimit: compositePauseThreshold(),
      detail: meta?.detail,
    });
    return { paused: true, reason };
  }

  return { paused: false };
}

/**
 * Record a negative deliverability signal. May trip a platform-wide 7h freeze.
 */
export async function recordDeliverabilitySignal(
  signal: DeliverabilitySignal,
  meta?: { userId?: string | null; campaignId?: string | null; detail?: string },
): Promise<{ paused: boolean; reason?: string }> {
  if (!guardEnabled()) return { paused: false };

  const existing = await getDeliverabilityPauseStatus();
  if (existing.paused) return { paused: true, reason: existing.reason ?? undefined };

  const now = Date.now();
  localEvents.push({ ts: now, signal });
  pruneLocal(now);

  const r = getRedis();
  let count = 0;
  if (r) {
    try {
      const key = countKey(signal);
      count = await r.incr(key);
      if (count === 1) {
        await r.pexpire(key, windowMs());
      }
    } catch {
      count = countSignalsInWindow(localEvents, now).get(signal) ?? 0;
    }
  } else {
    count = countSignalsInWindow(localEvents, now).get(signal) ?? 0;
  }

  const trip = await evaluateTripAfterSignal(signal, count, now, meta);
  if (trip.paused && trip.reason) {
    await activatePause(trip.reason);
    return trip;
  }

  if (meta?.userId || meta?.campaignId) {
    const limits = perSignalThresholds();
    console.warn(
      `[deliverability-guard] signal=${signal} user=${meta.userId ?? "?"} campaign=${meta.campaignId ?? "?"} (${count}/${limits[signal]})`,
    );
  }

  return { paused: false };
}

/** Pause in-flight campaigns when the guard trips mid-send. */
export async function pauseActiveCampaignsForDeliverabilityGuard(
  supabase: SupabaseClient,
  reason: string,
): Promise<number> {
  const now = new Date().toISOString();
  const msg =
    `Sending frozen ${pauseHours()}h to protect your ESP account (${reason}). ` +
    "All users must wait for the cooldown — contact the platform admin if this was a mistake.".slice(
      0,
      2000,
    );

  const { data, error } = await supabase
    .from("campaigns")
    .update({
      status: "paused",
      pause_reason: "deliverability_guard",
      paused_at: now,
      last_error: msg,
      updated_at: now,
    })
    .in("status", ["queued", "sending"])
    .select("id");

  if (error) {
    console.warn("[deliverability-guard] could not pause campaigns:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

export function formatDeliverabilityPauseMessage(status: DeliverabilityPauseStatus): string {
  if (!status.paused || !status.pausedUntil) {
    return "Sending is allowed.";
  }
  const until = new Date(status.pausedUntil).toLocaleString();
  return (
    `All sending is frozen until ${until} (${pauseHours()}h cooldown) to protect your SendGrid/ESP account from suspension. ` +
    (status.reason ? `Reason: ${status.reason}` : "")
  );
}
