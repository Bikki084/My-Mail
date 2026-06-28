import "server-only";

import {
  fetchLightsailPoolIpv4List,
  isAwsLightsailRotationConfigured,
} from "@/lib/aws-outbound-ip";

const IP_V4 =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

function parseCsvIpv4Env(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const ip = part.trim();
    if (IP_V4.test(ip)) out.push(ip);
  }
  return out;
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

/** Synthetic IPv4 for virtual pool expansion (audit / rotation UI). */
export function generateSyntheticOutboundIpv4(): string {
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

function stableUserPoolIndex(userId: string, poolSize: number): number {
  if (poolSize <= 0) return 0;
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) {
    h = (Math.imul(31, h) + userId.charCodeAt(i)) >>> 0;
  }
  return h % poolSize;
}

function dedupeIpv4List(ips: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ip of ips) {
    const t = ip.trim();
    if (!IP_V4.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function readVirtualPoolMinSize(): number {
  const n = Number(process.env.OUTBOUND_IP_VIRTUAL_POOL_MIN);
  if (Number.isFinite(n) && n > 0) return Math.min(10_000, Math.floor(n));
  return 50;
}

export function isExpandedVirtualPoolEnabled(): boolean {
  if (process.env.OUTBOUND_IP_VIRTUAL_POOL === "0") return false;
  if (process.env.OUTBOUND_IP_VIRTUAL_POOL === "1") return true;
  if (parseCsvIpv4Env("OUTBOUND_IP_POOL").length > 0) return true;
  if (process.env.OUTBOUND_IP_VIRTUAL_POOL_MIN?.trim()) return true;
  // Production default: logical IP pool for plan slots (5 users × N servers) without
  // requiring one Lightsail static IP per SMTP row.
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

export function shouldSkipLightsailAttach(): boolean {
  if (process.env.OUTBOUND_IP_SKIP_LIGHTSAIL_ATTACH === "1") return true;
  if (isExpandedVirtualPoolEnabled()) return true;
  return false;
}

/**
 * Expanded egress IP pool: Lightsail static IPs + OUTBOUND_IP_POOL + synthetic fill.
 */
export async function fetchExpandedOutboundIpPool(): Promise<string[]> {
  const merged: string[] = [];

  if (isAwsLightsailRotationConfigured()) {
    try {
      merged.push(...(await fetchLightsailPoolIpv4List()));
    } catch {
      /* pool lookup may fail without AWS creds */
    }
  }

  merged.push(...parseCsvIpv4Env("OUTBOUND_IP_POOL"));

  if (!isExpandedVirtualPoolEnabled()) {
    return dedupeIpv4List(merged);
  }

  const minSize = readVirtualPoolMinSize();
  const base = dedupeIpv4List(merged);
  const out = [...base];
  const seen = new Set(out);
  let guard = 0;
  while (out.length < minSize && guard < minSize * 3) {
    guard += 1;
    const ip = generateSyntheticOutboundIpv4();
    if (!seen.has(ip)) {
      seen.add(ip);
      out.push(ip);
    }
  }
  return out;
}

/** True when this IPv4 can be attached on Lightsail (real static IP in pool). */
export async function isAttachableLightsailIpv4(ip: string): Promise<boolean> {
  if (!isAwsLightsailRotationConfigured()) return false;
  const wanted = ip.trim();
  if (!IP_V4.test(wanted)) return false;
  try {
    const pool = await fetchLightsailPoolIpv4List();
    return pool.includes(wanted);
  } catch {
    return false;
  }
}

export async function shouldAttachLightsailForSendIp(ip: string): Promise<boolean> {
  if (shouldSkipLightsailAttach()) return false;
  return await isAttachableLightsailIpv4(ip);
}

/**
 * Pick the starting outbound IP for a user (spreads users across the pool).
 */
export async function resolveInitialOutboundIpForUser(userId: string): Promise<string> {
  const pool = await fetchExpandedOutboundIpPool();
  if (pool.length === 0) return generateSyntheticOutboundIpv4();
  return pool[stableUserPoolIndex(userId, pool.length)]!;
}

/**
 * Cycle to the next IP in the expanded pool (no AWS attach for virtual entries).
 */
export async function rotateExpandedPoolIp(previousIp: string | null): Promise<string> {
  const pool = await fetchExpandedOutboundIpPool();
  if (pool.length === 0) {
    throw new Error("Expanded outbound IP pool is empty.");
  }
  const prev = previousIp?.trim() || null;
  if (!prev) return pool[0]!;
  const idx = pool.indexOf(prev);
  const next = pool[(idx >= 0 ? idx + 1 : 0) % pool.length]!;
  if (prev && next === prev && pool.length > 1) {
    return pool[(idx >= 0 ? idx + 1 : 1) % pool.length]!;
  }
  return next;
}
