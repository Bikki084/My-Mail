"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  ensureLightsailPrimaryStaticIpAttached,
  fetchLightsailPoolIpv4List,
  fetchLightsailSendPoolIpv4List,
  fetchLightsailWebsiteIpv4,
  isAwsLightsailPoolRotationEnabled,
  type AwsOutboundIpMode,
} from "@/lib/aws-outbound-ip";
import {
  DEFAULT_ROTATION_THRESHOLD,
  MAX_ROTATION_THRESHOLD,
  getOrCreateOutboundIp,
  rotateOutboundIp,
  setRotationThreshold,
  shouldManualPauseForIpRotation,
} from "@/lib/outbound-ip";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type ServerIpSnapshot = {
  ip: string;
  /** Lightsail primary static IP — where the website stays reachable. */
  websiteIp: string | null;
  expiresAt: string;
  rotationThreshold: number;
  defaultThreshold: number;
  maxThreshold: number;
  mode: AwsOutboundIpMode;
  rotationConfigured: boolean;
  /** Pool rotation: toggle send IP without moving the website. */
  poolRotation: boolean;
  autoRotateOnThreshold: boolean;
  /** Total static IPs in AWS_LIGHTSAIL_STATIC_IP_NAMES. */
  poolSize: number | null;
  /** Send IPs available for rotation (pool minus website primary). */
  sendPoolSize: number | null;
  /** 1-based index in the send pool when active IP is not the website primary. */
  sendPoolIndex: number | null;
};

async function buildServerIpSnapshot(
  rec: Awaited<ReturnType<typeof getOrCreateOutboundIp>>,
): Promise<ServerIpSnapshot> {
  const poolRotation = isAwsLightsailPoolRotationEnabled();
  let websiteIp: string | null = null;
  let poolSize: number | null = null;
  let sendPoolSize: number | null = null;
  let sendPoolIndex: number | null = null;
  if (poolRotation) {
    try {
      websiteIp = await fetchLightsailWebsiteIpv4();
    } catch {
      websiteIp = null;
    }
    try {
      const pool = await fetchLightsailPoolIpv4List();
      const sendPool = await fetchLightsailSendPoolIpv4List();
      poolSize = pool.length;
      sendPoolSize = sendPool.length;
      if (websiteIp && rec.ip !== websiteIp) {
        const idx = sendPool.indexOf(rec.ip);
        sendPoolIndex = idx >= 0 ? idx + 1 : null;
      }
    } catch {
      poolSize = null;
      sendPoolSize = null;
      sendPoolIndex = null;
    }
  }
  return {
    ip: rec.ip,
    websiteIp,
    expiresAt: rec.expiresAt,
    rotationThreshold: rec.rotationThreshold,
    defaultThreshold: DEFAULT_ROTATION_THRESHOLD,
    maxThreshold: MAX_ROTATION_THRESHOLD,
    mode: rec.mode,
    rotationConfigured: rec.rotationConfigured,
    poolRotation,
    autoRotateOnThreshold: !shouldManualPauseForIpRotation(),
    poolSize,
    sendPoolSize,
    sendPoolIndex,
  };
}

async function requireUserId(): Promise<
  { ok: true; userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> }
  | { ok: false; error: string }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };
  return { ok: true, userId: user.id, supabase };
}

export async function getServerIpAction(): Promise<ActionResult<ServerIpSnapshot>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  try {
    if (isAwsLightsailPoolRotationEnabled()) {
      await ensureLightsailPrimaryStaticIpAttached();
    }
    const rec = await getOrCreateOutboundIp(auth.supabase, auth.userId, {
      alignPoolToPrimaryOnRead: isAwsLightsailPoolRotationEnabled(),
    });
    return { ok: true, data: await buildServerIpSnapshot(rec) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function rotateServerIpAction(): Promise<ActionResult<ServerIpSnapshot>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  try {
    const rec = await rotateOutboundIp(auth.supabase, auth.userId);
    return { ok: true, data: await buildServerIpSnapshot(rec) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setRotationThresholdAction(
  threshold: number,
): Promise<ActionResult<{ rotationThreshold: number }>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  try {
    const n = await setRotationThreshold(auth.supabase, auth.userId, threshold);
    return { ok: true, data: { rotationThreshold: n } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
