import "server-only";

import IORedis from "ioredis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePositiveIntEnv } from "@/lib/async-pool";
import { isRedisCircuitOpen } from "@/lib/circuit-breaker";

/**
 * Platform-wide send pause when reputation signals spike (spam reports, blocks,
 * bounces, SMTP spam rejects). ESPs do NOT report silent spam-folder placement —
 * this reacts to the earliest signals available before account suspension.
 */

export type DeliverabilitySignal =
  | "spam_report"
  | "blocked"
  | "hard_bounce"
  | "soft_bounce"
  | "deferred"
  | "dropped"
  | "smtp_spam_reject";

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

function thresholds(): Record<DeliverabilitySignal, number> {
  return {
    spam_report: parsePositiveIntEnv("DELIVERABILITY_SPAM_REPORT_THRESHOLD", 2),
    blocked: parsePositiveIntEnv("DELIVERABILITY_BLOCKED_THRESHOLD", 4),
    hard_bounce: parsePositiveIntEnv("DELIVERABILITY_HARD_BOUNCE_THRESHOLD", 8),
    soft_bounce: parsePositiveIntEnv("DELIVERABILITY_SOFT_BOUNCE_THRESHOLD", 15),
    deferred: parsePositiveIntEnv("DELIVERABILITY_DEFERRED_THRESHOLD", 20),
    dropped: parsePositiveIntEnv("DELIVERABILITY_DROPPED_THRESHOLD", 5),
    smtp_spam_reject: parsePositiveIntEnv("DELIVERABILITY_SMTP_SPAM_REJECT_THRESHOLD", 3),
  };
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

/** Classify SMTP failure text for reputation guard signals. */
export function classifySmtpErrorForGuard(message: string): DeliverabilitySignal | null {
  const m = message.toLowerCase();
  if (
    /spam|junk folder|unsolicited|blacklist|block list|reputation|5\.7\.1|5\.7\.0|554|policy reject|content rejected|abuse|complaint/.test(
      m,
    )
  ) {
    return "smtp_spam_reject";
  }
  if (/bounce|550 5\.1|551|552|553|user unknown|mailbox unavailable|does not exist|invalid recipient/.test(m)) {
    return "hard_bounce";
  }
  return null;
}

export function mapWebhookEventToSignal(eventType: string): DeliverabilitySignal | null {
  switch (eventType) {
    case "spam_report":
      return "spam_report";
    case "blocked":
      return "blocked";
    case "hard_bounce":
      return "hard_bounce";
    case "soft_bounce":
      return "soft_bounce";
    case "dropped":
      return "dropped";
    case "dropped":
      return "dropped";
    case "deferred":
      return "deferred";
    default:
      return null;
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
    `[deliverability-guard] ALL SENDS PAUSED until ${new Date(until).toISOString()} — ${reason}`,
  );
}

/**
 * Record a negative deliverability signal. May trip a platform-wide pause.
 */
export async function recordDeliverabilitySignal(
  signal: DeliverabilitySignal,
  meta?: { userId?: string | null; campaignId?: string | null; detail?: string },
): Promise<{ paused: boolean; reason?: string }> {
  if (!guardEnabled()) return { paused: false };

  const existing = await getDeliverabilityPauseStatus();
  if (existing.paused) return { paused: true, reason: existing.reason ?? undefined };

  const now = Date.now();
  const entry = { ts: now, signal };

  localEvents.push(entry);
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
      count = (countSignalsInWindow(localEvents, now).get(signal) ?? 0);
    }
  } else {
    count = countSignalsInWindow(localEvents, now).get(signal) ?? 0;
  }

  const t = thresholds();
  const limit = t[signal];
  if (count >= limit) {
    const reason = `${count} ${signal.replace(/_/g, " ")} signal(s) in the last ${windowMs() / 60_000} minutes (limit ${limit})`;
    const full = meta?.detail ? `${reason} — ${meta.detail}` : reason;
    await activatePause(full);
    return { paused: true, reason: full };
  }

  if (meta?.userId || meta?.campaignId) {
    console.warn(
      `[deliverability-guard] signal=${signal} user=${meta.userId ?? "?"} campaign=${meta.campaignId ?? "?"} (${count}/${limit})`,
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
    `Sending paused ${pauseHours()}h: deliverability guard triggered (${reason}). ` +
    "Wait for the cooldown or contact the platform admin.".slice(0, 2000);

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
    `Sending is temporarily paused until ${until} to protect your SMTP account. ` +
    (status.reason ? `Reason: ${status.reason}` : "")
  );
}
