import "server-only";

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowSendWithoutActivePlan } from "@/lib/active-plan-guard";
import { getActivePlanServerLimit } from "@/lib/smtp-plan-limit";
import { fetchExpandedOutboundIpPool } from "@/lib/outbound-ip-pool";

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

export type UserPlanIpPool = {
  /** Outbound IPs this user may rotate through (= plan server count). */
  ips: string[];
  /** Plan server cap; null = unlimited. */
  limit: number | null;
  unlimited: boolean;
  hasActivePlan: boolean;
};

function stableUserOffset(userId: string, span: number): number {
  if (span <= 0) return 0;
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) {
    h = (Math.imul(31, h) + userId.charCodeAt(i)) >>> 0;
  }
  return h % span;
}

/** Stable IPv4 for plan slot N when the master pool is smaller than the plan size. */
export function deterministicPlanSlotIp(userId: string, slot: number): string {
  const digest = createHash("sha256").update(`${userId}:plan-ip:${slot}`).digest();
  const octets = [digest[0]!, digest[1]!, digest[2]!, digest[3]!];
  let first = 11 + (octets[0]! % 115);
  if (first === 127) first = 128;
  if (first === 171) first = 172;
  return `${first}.${octets[1]}.${octets[2]}.${octets[3]}`;
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
    return {
      ips: master.length > 0 ? master : [deterministicPlanSlotIp(userId, 0)],
      limit: null,
      unlimited: true,
      hasActivePlan: true,
    };
  }

  const limit = await getActivePlanServerLimit(supabase, userId);
  if (limit === 0) {
    return { ips: [], limit: 0, unlimited: false, hasActivePlan: false };
  }

  const master = await fetchExpandedOutboundIpPool();
  const count = limit === null ? Math.max(1, master.length) : limit;
  const start = master.length > 0 ? stableUserOffset(userId, master.length) : 0;

  const ips: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (master.length > 0) {
      ips.push(master[(start + i) % master.length]!);
    } else {
      ips.push(deterministicPlanSlotIp(userId, i));
    }
  }

  const seen = new Set<string>();
  for (let i = 0; i < ips.length; i += 1) {
    let ip = ips[i]!;
    if (seen.has(ip)) {
      ip = deterministicPlanSlotIp(userId, i);
      ips[i] = ip;
    }
    seen.add(ip);
  }

  return {
    ips,
    limit,
    unlimited: limit === null,
    hasActivePlan: true,
  };
}

/** 1-based position of `ip` in the user's plan pool. */
export function indexInPlanPool(pool: string[], ip: string): number | null {
  const trimmed = ip.trim();
  if (!IP_V4.test(trimmed)) return null;
  const idx = pool.indexOf(trimmed);
  return idx >= 0 ? idx + 1 : null;
}

/** Next IP when the user clicks Refresh (wraps at the plan limit). */
export function nextIpInPlanPool(pool: string[], currentIp: string | null): string {
  if (pool.length === 0) {
    throw new Error("No outbound IPs on your plan. Activate a server plan under Wallet & Plan.");
  }
  if (pool.length === 1) return pool[0]!;
  const prev = currentIp?.trim() || null;
  if (!prev) return pool[0]!;
  const idx = pool.indexOf(prev);
  return pool[(idx >= 0 ? idx + 1 : 0) % pool.length]!;
}

export function firstIpInPlanPool(pool: string[]): string {
  if (pool.length === 0) {
    throw new Error("No outbound IPs on your plan. Activate a server plan under Wallet & Plan.");
  }
  return pool[0]!;
}

/** Keep `current_ip` inside the user's plan pool (reset to IP 1 if stale). */
export async function syncUserPlanPoolIp(
  supabase: SupabaseClient,
  userId: string,
  row: {
    current_ip: string;
    expires_at: string | null;
    rotation_threshold: number | null;
  },
  leaseDurationMs: number,
): Promise<string> {
  const { ips } = await resolveUserPlanIpPool(supabase, userId);
  if (ips.length === 0) return row.current_ip;
  if (ips.includes(row.current_ip.trim())) return row.current_ip;

  const ip = firstIpInPlanPool(ips);
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
      expires_at: expiresAt,
      rotation_threshold: rotationThreshold,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return ip;
}
