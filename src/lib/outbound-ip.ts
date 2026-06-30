/**
 * Per-user outbound IP rotation primitives. The send loop and the API routes
 * share these helpers so behaviour stays consistent regardless of who is
 * calling (BullMQ worker, sync delivery, server action).
 *
 * Production on AWS:
 *   - Set `AWS_LIGHTSAIL_STATIC_IP_NAMES` + `AWS_LIGHTSAIL_INSTANCE_NAME` (2+ IPs), or
 *   - `AWS_EC2_ALLOCATION_IDS` + `AWS_EC2_INSTANCE_ID` (2+ Elastic IPs), or
 *   - `OUTBOUND_IP_ROTATION_URL` for a proxy/VPS webhook.
 *   Default Lightsail pool rotation keeps the primary static IP attached for the
 *   website, cycles the active send IP in the panel/DB, attaches the send IP for
 *   SMTP during campaigns, and restores the primary when sending finishes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureLightsailEgressIpForSend,
  ensureLightsailPrimaryStaticIpAttached,
  fetchLightsailAttachedStaticIpv4,
  fetchLightsailPoolIpv4List,
  fetchLightsailSendPoolIpv4List,
  fetchLightsailWebsiteIpv4,
  resolveLightsailWebsitePrimaryIpv4,
  fetchLivePublicIpv4,
  isAwsEc2RotationConfigured,
  isAwsLightsailPoolRotationEnabled,
  isAwsLightsailRotationConfigured,
  isRotationUrlConfigured,
  releaseLightsailEgressToPrimary,
  resolveOutboundIpMode,
  rotateAwsOutboundIp,
  useInstancePublicIpMode,
  withLightsailEgressLock,
  type AwsOutboundIpMode,
} from "@/lib/aws-outbound-ip";
import { usesLightsailEgressAttach, usesProxyEgress } from "@/lib/egress-mode";
import {
  fetchExpandedOutboundIpPool,
  isDocumentationPlaceholderIp,
  isExpandedVirtualPoolEnabled,
  resolveInitialOutboundIpForUser,
  resolveOperationalEgressIp,
  rotateExpandedPoolIp,
  shouldAttachLightsailForSendIp,
  shouldSkipLightsailAttach,
} from "@/lib/outbound-ip-pool";
import {
  ipAtPlanRotationIndex,
  nextPlanRotationIndex,
  planPoolDisplayIndex,
  resolvePlanRotationIndex,
  resolveUserPlanIpPool,
  syncUserPlanPoolIp,
} from "@/lib/plan-ip-pool";
import {
  resolveExitIpv4ForSlot,
  verifyEgressProxyPool,
  getEgressProxyUrlForSlot,
  isBindEgressUrl,
} from "@/lib/smtp-egress-proxy";

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
    isAwsEc2RotationConfigured() ||
    isExpandedVirtualPoolEnabled()
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

  if (isExpandedVirtualPoolEnabled()) {
    return rotateExpandedPoolIp(prev);
  }

  if (isAwsLightsailRotationConfigured() || isAwsEc2RotationConfigured()) {
    return rotateAwsOutboundIp(prev);
  }

  if (useInstancePublicIpMode()) {
    const ip = await fetchLivePublicIpv4();
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
  if (isAwsLightsailPoolRotationEnabled()) {
    await ensureLightsailPrimaryStaticIpAttached();
    return (
      (await resolveLightsailWebsitePrimaryIpv4()) ??
      (await fetchLightsailWebsiteIpv4()) ??
      (await fetchLivePublicIpv4())
    );
  }
  if (useInstancePublicIpMode()) {
    return fetchLivePublicIpv4();
  }
  if (process.env.NODE_ENV === "production") {
    return fetchLivePublicIpv4();
  }
  return generateOutboundIp();
}

async function syncLiveOutboundIp(
  supabase: SupabaseClient,
  userId: string,
  row: {
    current_ip: string;
    expires_at: string | null;
    rotation_threshold: number | null;
  },
): Promise<string> {
  if (isAwsLightsailPoolRotationEnabled()) {
    return syncLightsailPoolOutboundIp(supabase, userId, row);
  }
  try {
    const live = await fetchLivePublicIpv4();
    if (live === row.current_ip) return live;
    const expiresAt =
      row.expires_at ?? new Date(Date.now() + LEASE_DURATION_MS).toISOString();
    const rotationThreshold =
      Number.isFinite(row.rotation_threshold) && row.rotation_threshold! > 0
        ? Number(row.rotation_threshold)
        : DEFAULT_ROTATION_THRESHOLD;
    await supabase.from("user_outbound_ip").upsert(
      {
        user_id: userId,
        current_ip: live,
        expires_at: expiresAt,
        rotation_threshold: rotationThreshold,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    return live;
  } catch {
    return row.current_ip;
  }
}

/** Panel load: always default the active send IP to the website primary (IP-1). */
async function alignLightsailPoolToPrimaryIp(
  supabase: SupabaseClient,
  userId: string,
  row: {
    current_ip: string;
    expires_at: string | null;
    rotation_threshold: number | null;
  },
): Promise<string> {
  try {
    const primary =
      (await resolveLightsailWebsitePrimaryIpv4()) ??
      (await fetchLightsailWebsiteIpv4()) ??
      (await fetchLightsailAttachedStaticIpv4()) ??
      row.current_ip;
    if (row.current_ip === primary) return primary;
    const expiresAt =
      row.expires_at ?? new Date(Date.now() + LEASE_DURATION_MS).toISOString();
    const rotationThreshold =
      Number.isFinite(row.rotation_threshold) && row.rotation_threshold! > 0
        ? Number(row.rotation_threshold)
        : DEFAULT_ROTATION_THRESHOLD;
    await supabase.from("user_outbound_ip").upsert(
      {
        user_id: userId,
        current_ip: primary,
        expires_at: expiresAt,
        rotation_threshold: rotationThreshold,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    return primary;
  } catch (e) {
    console.warn(
      `[outbound-ip] align to primary failed for user=${userId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return row.current_ip;
  }
}

/**
 * Before sending: confirm the website primary static IP is attached.
 * Default pool rotation never swaps AWS IPs during campaigns (that crashes the site).
 * Full attach only when AWS_LIGHTSAIL_SWAP_ATTACH_ON_ROTATE=1 (opt-in).
 */
export async function prepareLightsailEgressForCampaign(
  sendIp: string,
  slotIndex?: number,
): Promise<void> {
  if (!isAwsLightsailRotationConfigured()) return;

  if (isAwsLightsailPoolRotationEnabled()) {
    await withLightsailEgressLock(() => ensureLightsailPrimaryStaticIpAttached());
    console.log(
      "[outbound-ip] pool rotation — primary static IP confirmed (website stays up; send IP is UI tracking only).",
    );
    return;
  }

  if (!usesLightsailEgressAttach()) return;
  let wanted = sendIp.trim();
  if (!wanted) return;

  if (!(await shouldAttachLightsailForSendIp(wanted))) {
    wanted = await resolveOperationalEgressIp(wanted, slotIndex);
  }

  if (!(await shouldAttachLightsailForSendIp(wanted))) {
    console.log(
      `[outbound-ip] send IP=${sendIp.trim()} has no attachable Lightsail mapping — skipping attach.`,
    );
    return;
  }

  await withLightsailEgressLock(async () => {
    const websiteIp = (await resolveLightsailWebsitePrimaryIpv4())?.trim() ?? null;
    if (websiteIp && wanted === websiteIp) {
      await ensureLightsailPrimaryStaticIpAttached();
    } else {
      await ensureLightsailEgressIpForSend(wanted);
    }
    const live = await fetchLightsailAttachedStaticIpv4();
    if (live !== wanted) {
      throw new Error(
        `SMTP egress IP mismatch: expected ${wanted} but the server public IP is ${live}. ` +
          "Check AWS_LIGHTSAIL_STATIC_IP_NAMES and IAM permissions for AttachStaticIp.",
      );
    }
    console.log(`[outbound-ip] SMTP egress confirmed on ${live}`);
  });
}

/** Before sending: verify SOCKS/bind egress routes and log probed exit IPs. */
export async function prepareProxyEgressForCampaign(): Promise<void> {
  if (!usesProxyEgress()) return;
  const { ok, routes } = await verifyEgressProxyPool();
  if (!ok) {
    console.warn(
      "[outbound-ip] Proxy egress routes unavailable — sending via default OS routing (no bind/proxy override).",
    );
    return;
  }
  console.log(
    `[outbound-ip] proxy egress routes verified: ${routes
      .map((r) => `${r.url}→${r.exitIp ?? "?"}`)
      .join(", ")}`,
  );
}

/** After sending: restore website primary on AWS and reset the panel row to IP-1. */
export async function restoreLightsailWebsiteEgress(
  supabase?: SupabaseClient,
  userId?: string,
): Promise<void> {
  if (!shouldSkipLightsailAttach()) {
    await withLightsailEgressLock(() => releaseLightsailEgressToPrimary());
  }
  if (!supabase || !userId || !isAwsLightsailPoolRotationEnabled()) return;
  try {
    const primary = await resolveLightsailWebsitePrimaryIpv4();
    if (!primary) return;
    await supabase.from("user_outbound_ip").upsert(
      {
        user_id: userId,
        current_ip: primary,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    console.log(`[outbound-ip] panel send IP reset to website primary ${primary}`);
  } catch (e) {
    console.warn(
      `[outbound-ip] could not reset panel send IP to primary: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

async function syncLightsailPoolOutboundIp(
  supabase: SupabaseClient,
  userId: string,
  row: {
    current_ip: string;
    expires_at: string | null;
    rotation_threshold: number | null;
  },
): Promise<string> {
  try {
    const poolIps = isExpandedVirtualPoolEnabled()
      ? await fetchExpandedOutboundIpPool()
      : await fetchLightsailPoolIpv4List();
    if (poolIps.includes(row.current_ip)) return row.current_ip;
    const fallback =
      (await fetchLightsailWebsiteIpv4()) ?? poolIps[0] ?? row.current_ip;
    const expiresAt =
      row.expires_at ?? new Date(Date.now() + LEASE_DURATION_MS).toISOString();
    const rotationThreshold =
      Number.isFinite(row.rotation_threshold) && row.rotation_threshold! > 0
        ? Number(row.rotation_threshold)
        : DEFAULT_ROTATION_THRESHOLD;
    await supabase.from("user_outbound_ip").upsert(
      {
        user_id: userId,
        current_ip: fallback,
        expires_at: expiresAt,
        rotation_threshold: rotationThreshold,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    return fallback;
  } catch {
    return row.current_ip;
  }
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
  const mode: AwsOutboundIpMode = isExpandedVirtualPoolEnabled()
    ? "rotation_url"
    : resolveOutboundIpMode();
  return {
    mode,
    rotationConfigured: isOutboundIpRotationConfigured(),
  };
}

export const NO_ACTIVE_PLAN_IP_MESSAGE =
  "Activate a server plan under Wallet & Plan first. Outbound IP rotation unlocks after you activate a plan.";

async function resolveReadOnlyWebsiteDisplayIp(): Promise<string> {
  if (isAwsLightsailPoolRotationEnabled()) {
    await ensureLightsailPrimaryStaticIpAttached();
    return (
      (await resolveLightsailWebsitePrimaryIpv4()) ??
      (await fetchLightsailWebsiteIpv4()) ??
      (await fetchLivePublicIpv4())
    );
  }
  if (useInstancePublicIpMode() || isOutboundIpRotationConfigured()) {
    return await fetchLivePublicIpv4();
  }
  if (process.env.NODE_ENV === "production") {
    return await fetchLivePublicIpv4();
  }
  return generateOutboundIp();
}

/**
 * Read the user's outbound IP record. Lazily creates the row with the server's
 * current public IP (or dev stub) on first access.
 */
export type GetOutboundIpOptions = {
  /** SMTP panel read: show primary website IP until user clicks Rotate. */
  alignPoolToPrimaryOnRead?: boolean;
};

export async function getOrCreateOutboundIp(
  supabase: SupabaseClient,
  userId: string,
  opts?: GetOutboundIpOptions,
): Promise<OutboundIpRecord> {
  const planPool = await resolveUserPlanIpPool(supabase, userId);

  const existing = await supabase
    .from("user_outbound_ip")
    .select("current_ip, expires_at, rotation_threshold, plan_rotation_index")
    .eq("user_id", userId)
    .maybeSingle();

  if (planPool.ips.length > 0) {
    if (existing.data?.current_ip) {
      const synced = await syncUserPlanPoolIp(
        supabase,
        userId,
        existing.data,
        LEASE_DURATION_MS,
      );
      return {
        ip: synced.ip,
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
    const ip = ipAtPlanRotationIndex(planPool.ips, 0);
    const expiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
    const rotationThreshold =
      existing.data?.rotation_threshold && existing.data.rotation_threshold > 0
        ? Number(existing.data.rotation_threshold)
        : DEFAULT_ROTATION_THRESHOLD;
    await supabase.from("user_outbound_ip").upsert(
      {
        user_id: userId,
        current_ip: ip,
        plan_rotation_index: 0,
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

  // No active plan — show website IP only; rotation is blocked until plan activation.
  const displayIp = await resolveReadOnlyWebsiteDisplayIp();
  const rotationThreshold =
    existing.data?.rotation_threshold && existing.data.rotation_threshold > 0
      ? Number(existing.data.rotation_threshold)
      : DEFAULT_ROTATION_THRESHOLD;
  const expiresAt =
    existing.data?.expires_at ??
    new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  return {
    ip: displayIp,
    expiresAt,
    rotationThreshold,
    bootstrapped: false,
    mode: resolveOutboundIpMode(),
    rotationConfigured: false,
  };
}

/**
 * Assign a new egress IP, persist it, and return the new lease.
 */
export async function rotateOutboundIp(
  supabase: SupabaseClient,
  userId: string,
): Promise<OutboundIpRecord> {
  const planPool = await resolveUserPlanIpPool(supabase, userId);
  if (planPool.ips.length === 0) {
    throw new Error(
      "Activate a server plan under Wallet & Plan before rotating outbound IPs.",
    );
  }

  const before = await supabase
    .from("user_outbound_ip")
    .select("current_ip, rotation_threshold, plan_rotation_index")
    .eq("user_id", userId)
    .maybeSingle();
  const rotationThreshold =
    before.data?.rotation_threshold && before.data.rotation_threshold > 0
      ? Number(before.data.rotation_threshold)
      : DEFAULT_ROTATION_THRESHOLD;
  const currentIndex = resolvePlanRotationIndex(
    planPool.ips,
    before.data?.current_ip ?? null,
    before.data?.plan_rotation_index,
  );
  const nextIndex = nextPlanRotationIndex(planPool.ips.length, currentIndex);
  const ip = ipAtPlanRotationIndex(planPool.ips, nextIndex);

  // External SOCKS: align display IP with probed exit. Bind routes keep plan pool IP (unique per slot).
  if (usesProxyEgress()) {
    const egressUrl = await getEgressProxyUrlForSlot(nextIndex);
    if (egressUrl && !isBindEgressUrl(egressUrl)) {
      const probed = await resolveExitIpv4ForSlot(nextIndex, true);
      if (probed) {
        await supabase.from("user_outbound_ip").upsert(
          {
            user_id: userId,
            current_ip: probed,
            plan_rotation_index: nextIndex,
            expires_at: new Date(Date.now() + LEASE_DURATION_MS).toISOString(),
            rotation_threshold: rotationThreshold,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        return {
          ip: probed,
          expiresAt: new Date(Date.now() + LEASE_DURATION_MS).toISOString(),
          rotationThreshold,
          bootstrapped: false,
          ...recordMeta(),
        };
      }
    }
  }

  const expiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
  const { error } = await supabase.from("user_outbound_ip").upsert(
    {
      user_id: userId,
      current_ip: ip,
      plan_rotation_index: nextIndex,
      expires_at: expiresAt,
      rotation_threshold: rotationThreshold,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);

  if (usesLightsailEgressAttach()) {
    try {
      await prepareLightsailEgressForCampaign(ip, nextIndex);
    } catch (e) {
      console.warn(
        `[outbound-ip] Lightsail attach after rotate failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  } else if (usesProxyEgress()) {
    try {
      await prepareProxyEgressForCampaign();
    } catch (e) {
      console.warn(
        `[outbound-ip] Proxy egress verify after rotate failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  return {
    ip,
    expiresAt,
    rotationThreshold,
    bootstrapped: false,
    ...recordMeta(),
  };
}

/**
 * Reset send IP rotation to slot 1 when the user activates a new plan.
 * Keeps their rotation threshold; starts fresh at index 0 in the new plan pool.
 */
export async function resetOutboundIpRotationForNewPlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const planPool = await resolveUserPlanIpPool(supabase, userId);
  if (planPool.ips.length === 0) return;

  const { data: existing } = await supabase
    .from("user_outbound_ip")
    .select("rotation_threshold")
    .eq("user_id", userId)
    .maybeSingle();

  const rotationThreshold =
    Number.isFinite(existing?.rotation_threshold) &&
    existing!.rotation_threshold! > 0
      ? Number(existing!.rotation_threshold)
      : DEFAULT_ROTATION_THRESHOLD;

  const ip = ipAtPlanRotationIndex(planPool.ips, 0);
  const expiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();

  const { error } = await supabase.from("user_outbound_ip").upsert(
    {
      user_id: userId,
      current_ip: ip,
      plan_rotation_index: 0,
      expires_at: expiresAt,
      rotation_threshold: rotationThreshold,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    throw new Error(`Could not reset outbound IP for new plan: ${error.message}`);
  }

  if (isAwsLightsailPoolRotationEnabled()) {
    await ensureLightsailPrimaryStaticIpAttached().catch((e) => {
      console.warn(
        `[outbound-ip] primary attach after new-plan reset failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    });
  }

  console.log(
    `[outbound-ip] new plan activated — rotation reset to slot 1 (${ip}) for user=${userId}`,
  );
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
