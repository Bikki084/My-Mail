import "server-only";

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowSendWithoutActivePlan } from "@/lib/active-plan-guard";
import { getActivePlanServerLimit } from "@/lib/smtp-plan-limit";
import {
  fetchExpandedOutboundIpPool,
  fetchPlanIpMaster,
  isDocumentationPlaceholderIp,
} from "@/lib/outbound-ip-pool";
import { resolveEgressMode } from "@/lib/egress-mode";
import {
  resolveEgressProxyPool,
} from "@/lib/smtp-egress-proxy";

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

/** Rotation pool size when plan allows unlimited SMTP servers. */
const UNLIMITED_PLAN_ROTATION_SLOTS = 50;

export type UserPlanIpPool = {
  /** Outbound IPs this user may rotate through (= plan server count). */
  ips: string[];
  /** Plan server cap; null = unlimited. */
  limit: number | null;
  unlimited: boolean;
  hasActivePlan: boolean;
  /** Distinct IPv4s in `ips` (may be fewer when slots share the same egress IP). */
  uniqueIpCount: number;
};

function countUniqueIpv4(ips: string[]): number {
  const seen = new Set<string>();
  for (const ip of ips) {
    const t = ip.trim();
    if (IP_V4.test(t)) seen.add(t);
  }
  return seen.size;
}

/** Stable IPv4 for plan slot N — unique per user and slot index. */
export function deterministicPlanSlotIp(userId: string, slot: number): string {
  const digest = createHash("sha256").update(`${userId}:plan-ip:${slot}`).digest();
  const octets = [digest[0]!, digest[1]!, digest[2]!, digest[3]!];
  let first = 11 + (octets[0]! % 115);
  if (first === 127) first = 128;
  if (first === 171) first = 172;
  return `${first}.${octets[1]}.${octets[2]}.${octets[3]}`;
}

/**
 * Build exactly `count` unique IPs: real pool IPs first, then deterministic slots.
 * Each plan server slot maps to one distinct IP (no duplicates — duplicates broke rotation).
 */
export function buildUniquePlanIpPool(
  userId: string,
  count: number,
  master: string[],
  allowSynthetic = true,
): string[] {
  const target = Math.max(1, Math.floor(count));
  const ips: string[] = [];
  const seen = new Set<string>();

  for (const raw of master) {
    if (ips.length >= target) break;
    const ip = raw.trim();
    if (!IP_V4.test(ip) || seen.has(ip)) continue;
    ips.push(ip);
    seen.add(ip);
  }

  if (!allowSynthetic) {
    return ips;
  }

  let slot = 0;
  while (ips.length < target) {
    let ip = deterministicPlanSlotIp(userId, slot);
    let guard = 0;
    while (seen.has(ip) && guard < 1024) {
      slot += 1;
      ip = deterministicPlanSlotIp(userId, slot);
      guard += 1;
    }
    ips.push(ip);
    seen.add(ip);
    slot += 1;
  }

  return ips;
}

/**
 * Build this user's personal send-IP list. Size matches their active plan
 * (`servers_allowed`): 500 credits → 10 IPs, 1,000 → 30, etc.
 */
export async function resolveUserPlanIpPool(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserPlanIpPool> {
  if (allowSendWithoutActivePlan()) {
    const master = await fetchExpandedOutboundIpPool();
    const ips =
      master.length > 0 ? master : [deterministicPlanSlotIp(userId, 0)];
    return {
      ips,
      limit: null,
      unlimited: true,
      hasActivePlan: true,
      uniqueIpCount: countUniqueIpv4(ips),
    };
  }

  const limit = await getActivePlanServerLimit(supabase, userId);
  if (limit === 0) {
    return {
      ips: [],
      limit: 0,
      unlimited: false,
      hasActivePlan: false,
      uniqueIpCount: 0,
    };
  }

  const mode = resolveEgressMode();
  const count = limit === null ? UNLIMITED_PLAN_ROTATION_SLOTS : limit;

  async function buildPlanRotationIpList(): Promise<string[]> {
    const master = await fetchPlanIpMaster();
    return buildUniquePlanIpPool(userId, count, master, true);
  }

  if (mode === "proxy") {
    const routes = await resolveEgressProxyPool();
    if (routes.length === 0) {
      console.warn(
        "[plan-ip-pool] OUTBOUND_IP_EGRESS_MODE=proxy but no egress routes. Set OUTBOUND_IP_PROXY_AUTO_BIND=1 with OUTBOUND_IP_POOL or real OUTBOUND_IP_PROXY_POOL.",
      );
      return {
        ips: [],
        limit,
        unlimited: false,
        hasActivePlan: true,
        uniqueIpCount: 0,
      };
    }
    // Use planned IPs (AWS pool) for rotation UI — not probed exit (bind routes all report the attached IP).
    const master = await fetchPlanIpMaster();
    const ips = buildUniquePlanIpPool(userId, count, master, true);
    return {
      ips,
      limit,
      unlimited: limit === null,
      hasActivePlan: true,
      uniqueIpCount: countUniqueIpv4(ips),
    };
  }

  if (mode === "lightsail") {
    const ips = await buildPlanRotationIpList();
    if (ips.length === 0) {
      console.warn(
        "[plan-ip-pool] OUTBOUND_IP_EGRESS_MODE=lightsail but no attachable IPs in AWS pool.",
      );
    }
    return {
      ips,
      limit,
      unlimited: limit === null,
      hasActivePlan: true,
      uniqueIpCount: countUniqueIpv4(ips),
    };
  }

  const master = await fetchExpandedOutboundIpPool();
  const planCount = limit === null ? Math.max(1, master.length) : limit;
  const ips = buildUniquePlanIpPool(userId, planCount, master, true);

  return {
    ips,
    limit,
    unlimited: limit === null,
    hasActivePlan: true,
    uniqueIpCount: countUniqueIpv4(ips),
  };
}

/** 1-based display index for UI (e.g. 3 of 10). */
export function planPoolDisplayIndex(poolLength: number, rotationIndex: number): number {
  if (poolLength <= 0) return 1;
  const idx = Math.floor(rotationIndex);
  if (!Number.isFinite(idx) || idx < 0) return 1;
  return (idx % poolLength) + 1;
}

/** Resolve stored rotation index from current IP (fallback when column missing). */
export function resolvePlanRotationIndex(
  pool: string[],
  currentIp: string | null,
  storedIndex: number | null | undefined,
): number {
  if (pool.length === 0) return 0;
  const stored = Math.floor(Number(storedIndex));
  const trimmed = currentIp?.trim() ?? "";

  if (trimmed && !isDocumentationPlaceholderIp(trimmed)) {
    const found = pool.indexOf(trimmed);
    if (found >= 0) {
      // Prefer the slot that owns this IP when it disagrees with a stale stored index.
      if (
        Number.isFinite(stored) &&
        stored >= 0 &&
        stored < pool.length &&
        pool[stored] === trimmed
      ) {
        return stored;
      }
      return found;
    }
  }

  if (Number.isFinite(stored) && stored >= 0 && stored < pool.length) {
    return stored;
  }

  if (trimmed && isDocumentationPlaceholderIp(trimmed)) {
    return 0;
  }
  return 0;
}

/** Next slot index after Refresh (wraps at plan size). */
export function nextPlanRotationIndex(
  poolLength: number,
  currentIndex: number,
): number {
  if (poolLength <= 0) {
    throw new Error("No outbound IPs on your plan. Activate a server plan under Wallet & Plan.");
  }
  if (poolLength === 1) return 0;
  const idx = Math.floor(currentIndex);
  const safe = Number.isFinite(idx) && idx >= 0 ? idx : 0;
  return (safe + 1) % poolLength;
}

export function ipAtPlanRotationIndex(pool: string[], index: number): string {
  if (pool.length === 0) {
    throw new Error("No outbound IPs on your plan. Activate a server plan under Wallet & Plan.");
  }
  const idx = Math.floor(index);
  const safe =
    Number.isFinite(idx) && idx >= 0 && idx < pool.length ? idx : 0;
  return pool[safe]!;
}

/** Keep `current_ip` and rotation index aligned with the user's plan pool. */
export async function syncUserPlanPoolIp(
  supabase: SupabaseClient,
  userId: string,
  row: {
    current_ip: string;
    expires_at: string | null;
    rotation_threshold: number | null;
    plan_rotation_index?: number | null;
  },
  leaseDurationMs: number,
): Promise<{ ip: string; rotationIndex: number }> {
  const { ips } = await resolveUserPlanIpPool(supabase, userId);
  if (ips.length === 0) {
    return { ip: row.current_ip, rotationIndex: 0 };
  }

  const rotationIndex = resolvePlanRotationIndex(
    ips,
    row.current_ip,
    row.plan_rotation_index,
  );
  const ip = ipAtPlanRotationIndex(ips, rotationIndex);
  const expiresAt =
    row.expires_at ?? new Date(Date.now() + leaseDurationMs).toISOString();
  const rotationThreshold =
    Number.isFinite(row.rotation_threshold) && row.rotation_threshold! > 0
      ? Number(row.rotation_threshold)
      : 1000;

  await supabase.from("user_outbound_ip").upsert(
    {
      user_id: userId,
      current_ip: ip,
      plan_rotation_index: rotationIndex,
      expires_at: expiresAt,
      rotation_threshold: rotationThreshold,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return { ip, rotationIndex };
}
