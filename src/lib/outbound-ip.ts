/**
 * Per-user outbound IP rotation primitives. The send loop and the API routes
 * share these helpers so behaviour stays consistent regardless of who is
 * calling (BullMQ worker, sync delivery, server action).
 *
 * Production on AWS:
 *   - Set `AWS_LIGHTSAIL_STATIC_IP_NAMES` + `AWS_LIGHTSAIL_INSTANCE_NAME` (2+ IPs), or
 *   - `AWS_EC2_ALLOCATION_IDS` + `AWS_EC2_INSTANCE_ID` (2+ Elastic IPs), or
 *   - `OUTBOUND_IP_ROTATION_URL` for a proxy/VPS webhook.
 *   After rotation the server's public IP changes and new SMTP connections egress
 *   from that address automatically.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInstancePublicIpv4,
  isAwsEc2RotationConfigured,
  isAwsLightsailRotationConfigured,
  isRotationUrlConfigured,
  resolveOutboundIpMode,
  rotateAwsOutboundIp,
  useInstancePublicIpMode,
  type AwsOutboundIpMode,
} from "@/lib/aws-outbound-ip";

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
  mode: AwsOutboundIpMode;
  rotationConfigured: boolean;
};

export function isOutboundIpRotationConfigured(): boolean {
  return (
    isRotationUrlConfigured() ||
    isAwsLightsailRotationConfigured() ||
    isAwsEc2RotationConfigured()
  );
}

/**
 * When true, campaigns pause at the burst threshold until the user rotates IP
 * and resumes. When false (default with AWS/URL rotation), the worker rotates
 * automatically and continues sending on the new IP.
 */
export function shouldManualPauseForIpRotation(): boolean {
  if (process.env.CAMPAIGN_MANUAL_IP_ROTATION_PAUSE === "1") return true;
  if (isOutboundIpRotationConfigured()) return false;
  return true;
}

/**
 * Stub generator — dev-only when no AWS/URL/instance IP is available.
 */
export function generateOutboundIp(): string {
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

async function resolveFromRotationUrl(): Promise<string> {
  const url = process.env.OUTBOUND_IP_ROTATION_URL!.trim();
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

/**
 * Resolve the next outbound IP for rotation.
 */
export async function resolveOutboundIpForRotation(
  previousIp?: string | null,
): Promise<string> {
  const prev = previousIp?.trim() || null;

  if (isRotationUrlConfigured()) {
    const ip = await resolveFromRotationUrl();
    if (prev && ip === prev) {
      throw new Error(
        "Rotation service returned the same IP. Configure your provider to assign a new egress address.",
      );
    }
    return ip;
  }

  if (isAwsLightsailRotationConfigured() || isAwsEc2RotationConfigured()) {
    return rotateAwsOutboundIp(prev);
  }

  if (useInstancePublicIpMode()) {
    const ip = await fetchInstancePublicIpv4();
    if (prev && ip === prev) {
      throw new Error(
        "Server public IP unchanged. Allocate 2+ Lightsail static IPs (or EC2 Elastic IPs) and set AWS_LIGHTSAIL_STATIC_IP_NAMES on the server to enable rotation.",
      );
    }
    return ip;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Outbound IP rotation is not configured. Set AWS_LIGHTSAIL_STATIC_IP_NAMES (2+ names) and AWS_LIGHTSAIL_INSTANCE_NAME, or OUTBOUND_IP_ROTATION_URL, in .env.local on the server.",
    );
  }

  let ip = generateOutboundIp();
  if (prev) {
    let attempts = 0;
    while (ip === prev && attempts < 12) {
      ip = generateOutboundIp();
      attempts += 1;
    }
  }
  return ip;
}

/** Initial IP for a new user row (no rotation — read current egress). */
async function resolveInitialOutboundIp(): Promise<string> {
  if (useInstancePublicIpMode()) {
    return fetchInstancePublicIpv4();
  }
  if (process.env.NODE_ENV === "production") {
    return fetchInstancePublicIpv4();
  }
  return generateOutboundIp();
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

function recordMeta(): Pick<OutboundIpRecord, "mode" | "rotationConfigured"> {
  return {
    mode: resolveOutboundIpMode(),
    rotationConfigured: isOutboundIpRotationConfigured(),
  };
}

/**
 * Read the user's outbound IP record. Lazily creates the row with the server's
 * current public IP (or dev stub) on first access.
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
      ...recordMeta(),
    };
  }
  const ip = await resolveInitialOutboundIp();
  const expiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const rotationThreshold =
    existing.data?.rotation_threshold && existing.data.rotation_threshold > 0
      ? Number(existing.data.rotation_threshold)
      : DEFAULT_ROTATION_THRESHOLD;
  await supabase.from("user_outbound_ip").upsert(
    {
      user_id: userId,
      current_ip: ip,
      expires_at: expiresAt,
      rotation_threshold: rotationThreshold,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return {
    ip,
    expiresAt,
    rotationThreshold,
    bootstrapped: true,
    ...recordMeta(),
  };
}

/**
 * Assign a new egress IP, persist it, and return the new lease.
 */
export async function rotateOutboundIp(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutboundIpRecord> {
  const before = await supabase
    .from("user_outbound_ip")
    .select("current_ip, rotation_threshold")
    .eq("user_id", userId)
    .maybeSingle();
  const rotationThreshold =
    before.data?.rotation_threshold && before.data.rotation_threshold > 0
      ? Number(before.data.rotation_threshold)
      : DEFAULT_ROTATION_THRESHOLD;
  const previousIp = before.data?.current_ip?.trim() || null;
  const ip = await resolveOutboundIpForRotation(previousIp);
  const expiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const { error } = await supabase.from("user_outbound_ip").upsert(
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
  return {
    ip,
    expiresAt,
    rotationThreshold,
    bootstrapped: false,
    ...recordMeta(),
  };
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
  const { error } = await supabase.from("user_outbound_ip").upsert(
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
