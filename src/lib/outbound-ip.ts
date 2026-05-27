/**
 * Per-user outbound IP rotation primitives. The send loop and the API routes
 * share these helpers so behaviour stays consistent regardless of who is
 * calling (BullMQ worker, sync delivery, server action).
 *
 * Production: set `OUTBOUND_IP_ROTATION_URL` to your proxy/VPS control-plane
 * (Bright Data, Oxylabs, SmartProxy, a small VPS webhook that reassigns exit
 * IP, etc.); otherwise a synthetic IPv4 is stored for UI/audit only. Campaign
 * sending can auto-rotate after each burst (see `CAMPAIGN_MANUAL_IP_ROTATION_PAUSE`
 * in `campaign-delivery.ts`).
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
 * Stub generator — returns a plausible-looking public IPv4 when no webhook is
 * configured. For production, prefer `OUTBOUND_IP_ROTATION_URL` (see
 * `resolveOutboundIpForRotation`).
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

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

function parseIpFromRotationResponseBody(text: string, contentType: string): string | null {
  const trimmed = text.trim();
  if (IP_V4.test(trimmed)) return trimmed;
  if (!/json/i.test(contentType)) return null;
  try {
    const j = JSON.parse(trimmed) as unknown;
    if (typeof j === "string" && IP_V4.test(j)) return j;
    if (j && typeof j === "object") {
      const o = j as Record<string, unknown>;
      const ip = o.ip ?? o.IP ?? o.address;
      if (typeof ip === "string" && IP_V4.test(ip.trim())) return ip.trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve the next outbound IP for rotation. If `OUTBOUND_IP_ROTATION_URL` is
 * set, performs an HTTP request (paid proxy / your VPS API) and parses the
 * response; otherwise uses `generateOutboundIp()`.
 *
 * Optional: `OUTBOUND_IP_ROTATION_TOKEN` as Bearer token, `OUTBOUND_IP_ROTATION_METHOD`
 * = POST for POST instead of GET.
 */
export async function resolveOutboundIpForRotation(): Promise<string> {
  const url = process.env.OUTBOUND_IP_ROTATION_URL?.trim();
  if (!url) return generateOutboundIp();

  const token = process.env.OUTBOUND_IP_ROTATION_TOKEN?.trim();
  const method =
    process.env.OUTBOUND_IP_ROTATION_METHOD?.trim().toUpperCase() === "POST"
      ? "POST"
      : "GET";

  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST"
      ? { body: process.env.OUTBOUND_IP_ROTATION_POST_BODY?.trim() || "{}" }
      : {}),
    signal: AbortSignal.timeout(
      Math.min(
        60_000,
        Math.max(5_000, Number(process.env.OUTBOUND_IP_ROTATION_TIMEOUT_MS) || 30_000),
      ),
    ),
  });

  if (!res.ok) {
    throw new Error(
      `OUTBOUND_IP_ROTATION_URL returned ${res.status} ${res.statusText}`.slice(0, 500),
    );
  }
  const text = await res.text();
  const parsed = parseIpFromRotationResponseBody(text, res.headers.get("content-type") ?? "");
  if (!parsed) {
    throw new Error(
      "OUTBOUND_IP_ROTATION_URL response did not contain a parsable IPv4 (JSON {ip} or plain text).",
    );
  }
  return parsed;
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
  const ip = await resolveOutboundIpForRotation();
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
  const ip = await resolveOutboundIpForRotation();
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
