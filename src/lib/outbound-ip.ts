/**
 * Per-user outbound IP rotation primitives. The send loop and the API routes
 * share these helpers so behaviour stays consistent regardless of who is
 * calling (BullMQ worker, sync delivery, server action).
 *
 * Production note: `generateOutboundIp` is the only function that is
 * intentionally a stub — swap its body with a call to your real proxy/VPS
 * provider (e.g. Bright Data / Oxylabs / SmartProxy / a homegrown rotation
 * service) and everything else (UI modal, pause/resume contract,
 * `sending_logs` audit) keeps working unchanged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Default burst size if the user has never tuned the panel. Matches the spec. */
export const DEFAULT_ROTATION_THRESHOLD = 1000;

/** Hard cap so a typo in the panel can't disable rotation entirely. */
export const MAX_ROTATION_THRESHOLD = 100_000;

/** UI hint: how long a freshly-rotated IP is considered "fresh" (ms). */
const LEASE_DURATION_MS = 24 * 60 * 60 * 1000;

export type OutboundIpRecord = {
  ip: string;
  expiresAt: string;
  rotationThreshold: number;
  /** True when this row was created in this call (i.e. user's first ever read). */
  bootstrapped: boolean;
};

/**
 * Stub generator — returns a plausible-looking public IPv4. In production,
 * replace the body with a call to your rotation provider and return the IP
 * they hand you. Everything else in the codebase stays the same.
 */
export function generateOutboundIp(): string {
  // Public-range octets only; avoid 0.x.x.x, 127.x.x.x, and 10/172/192 RFC1918.
  const first = pickFromRanges([
    [11, 126],
    [128, 169],
    [171, 171],
    [173, 191],
    [193, 223],
  ]);
  const o = () => Math.floor(Math.random() * 256);
  return `${first}.${o()}.${o()}.${o()}`;
}

function pickFromRanges(ranges: ReadonlyArray<readonly [number, number]>): number {
  const total = ranges.reduce((acc, [lo, hi]) => acc + (hi - lo + 1), 0);
  let n = Math.floor(Math.random() * total);
  for (const [lo, hi] of ranges) {
    const span = hi - lo + 1;
    if (n < span) return lo + n;
    n -= span;
  }
  return ranges[0]![0];
}

/**
 * Read the user's outbound IP record. Lazily creates the row with a generated
 * IP the first time it is requested so the UI never has to special-case
 * "no row yet". Safe to call from the worker — uses the supplied client's
 * permissions (service role bypasses RLS, the user's own session does too).
 */
export async function getOrCreateOutboundIp(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutboundIpRecord> {
  const existing = await supabase
    .from("user_outbound_ip")
    .select("current_ip, expires_at, rotation_threshold")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.data && existing.data.current_ip) {
    return {
      ip: existing.data.current_ip,
      expiresAt:
        existing.data.expires_at ??
        new Date(Date.now() + LEASE_DURATION_MS).toISOString(),
      rotationThreshold:
        Number.isFinite(existing.data.rotation_threshold) &&
        existing.data.rotation_threshold > 0
          ? Number(existing.data.rotation_threshold)
          : DEFAULT_ROTATION_THRESHOLD,
      bootstrapped: false,
    };
  }
  const ip = generateOutboundIp();
  const expiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const rotationThreshold =
    existing.data?.rotation_threshold && existing.data.rotation_threshold > 0
      ? Number(existing.data.rotation_threshold)
      : DEFAULT_ROTATION_THRESHOLD;
  await supabase
    .from("user_outbound_ip")
    .upsert(
      {
        user_id: userId,
        current_ip: ip,
        expires_at: expiresAt,
        rotation_threshold: rotationThreshold,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  return { ip, expiresAt, rotationThreshold, bootstrapped: true };
}

/**
 * Generate a new IP for the user, persist it, and return the new lease.
 * Always succeeds — if the row doesn't exist yet, it is created.
 */
export async function rotateOutboundIp(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutboundIpRecord> {
  const before = await supabase
    .from("user_outbound_ip")
    .select("rotation_threshold")
    .eq("user_id", userId)
    .maybeSingle();
  const rotationThreshold =
    before.data?.rotation_threshold && before.data.rotation_threshold > 0
      ? Number(before.data.rotation_threshold)
      : DEFAULT_ROTATION_THRESHOLD;
  const ip = generateOutboundIp();
  const expiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const { error } = await supabase
    .from("user_outbound_ip")
    .upsert(
      {
        user_id: userId,
        current_ip: ip,
        expires_at: expiresAt,
        rotation_threshold: rotationThreshold,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
  return { ip, expiresAt, rotationThreshold, bootstrapped: false };
}

/** Persist a new rotation threshold, clamped to the safe range. */
export async function setRotationThreshold(
  supabase: SupabaseClient,
  userId: string,
  raw: number,
): Promise<number> {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Rotation threshold must be a positive integer.");
  }
  if (n > MAX_ROTATION_THRESHOLD) {
    throw new Error(
      `Rotation threshold must be ${MAX_ROTATION_THRESHOLD.toLocaleString()} or less.`,
    );
  }
  const { error } = await supabase
    .from("user_outbound_ip")
    .upsert(
      {
        user_id: userId,
        rotation_threshold: n,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
  return n;
}
