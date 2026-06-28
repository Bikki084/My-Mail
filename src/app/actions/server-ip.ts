"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  ensureLightsailPrimaryStaticIpAttached,
  isAwsLightsailPoolRotationEnabled,
  type AwsOutboundIpMode,
} from "@/lib/aws-outbound-ip";
import {
  DEFAULT_ROTATION_THRESHOLD,
  MAX_ROTATION_THRESHOLD,
  NO_ACTIVE_PLAN_IP_MESSAGE,
  getOrCreateOutboundIp,
  rotateOutboundIp,
  setRotationThreshold,
  shouldManualPauseForIpRotation,
} from "@/lib/outbound-ip";
import {
  egressModeLabel,
  resolveEgressMode,
  type EgressMode,
} from "@/lib/egress-mode";
import {
  planPoolDisplayIndex,
  resolveUserPlanIpPool,
} from "@/lib/plan-ip-pool";

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
  /** Plan-scoped send IP rotation (Refresh cycles 1…N from the active plan). */
  poolRotation: boolean;
  autoRotateOnThreshold: boolean;
  poolSize: number | null;
  /** Send IPs on the user's active plan (same number as SMTP server slots). */
  sendPoolSize: number | null;
  /** 1-based index in the plan send pool (e.g. 3 of 10). */
  sendPoolIndex: number | null;
  /** Distinct egress IPv4s (may be less than sendPoolSize when slots share IPs). */
  uniqueEgressIpCount: number | null;
  /** Human label for unlimited plans. */
  planServersLabel: string | null;
  hasActivePlan: boolean;
  canRotate: boolean;
  noPlanMessage: string;
  egressMode: EgressMode;
  egressModeLabel: string;
};

async function buildServerIpSnapshot(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  rec: Awaited<ReturnType<typeof getOrCreateOutboundIp>>,
): Promise<ServerIpSnapshot> {
  const planPool = await resolveUserPlanIpPool(supabase, userId);
  const planScoped = planPool.ips.length > 0;

  const { data: ipRow } = await supabase
    .from("user_outbound_ip")
    .select("plan_rotation_index")
    .eq("user_id", userId)
    .maybeSingle();

  const sendPoolSize = planScoped
    ? planPool.unlimited
      ? planPool.ips.length
      : (planPool.limit ?? planPool.ips.length)
    : null;
  const rotationIndex = ipRow?.plan_rotation_index ?? 0;
  const sendPoolIndex = planScoped
    ? planPoolDisplayIndex(planPool.ips.length, Number(rotationIndex))
    : null;
  const uniqueEgressIpCount = planScoped ? planPool.uniqueIpCount : null;
  const planServersLabel = planPool.unlimited
    ? "Unlimited"
    : planPool.limit != null
      ? String(planPool.limit)
      : null;

  const egressMode = resolveEgressMode();

  return {
    ip: rec.ip,
    websiteIp: null,
    expiresAt: rec.expiresAt,
    rotationThreshold: rec.rotationThreshold,
    defaultThreshold: DEFAULT_ROTATION_THRESHOLD,
    maxThreshold: MAX_ROTATION_THRESHOLD,
    mode: rec.mode,
    rotationConfigured: planScoped,
    poolRotation: planScoped,
    autoRotateOnThreshold: planScoped && !shouldManualPauseForIpRotation(),
    poolSize: sendPoolSize,
    sendPoolSize: planScoped ? planPool.ips.length : sendPoolSize,
    sendPoolIndex,
    uniqueEgressIpCount,
    planServersLabel,
    hasActivePlan: planPool.hasActivePlan,
    canRotate: planPool.hasActivePlan && planPool.ips.length > 0,
    noPlanMessage: NO_ACTIVE_PLAN_IP_MESSAGE,
    egressMode,
    egressModeLabel: egressModeLabel(egressMode),
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
    const rec = await getOrCreateOutboundIp(auth.supabase, auth.userId);
    return {
      ok: true,
      data: await buildServerIpSnapshot(auth.supabase, auth.userId, rec),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function rotateServerIpAction(): Promise<ActionResult<ServerIpSnapshot>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;

  const planPool = await resolveUserPlanIpPool(auth.supabase, auth.userId);
  if (!planPool.hasActivePlan || planPool.ips.length === 0) {
    return { ok: false, error: NO_ACTIVE_PLAN_IP_MESSAGE };
  }

  try {
    const rec = await rotateOutboundIp(auth.supabase, auth.userId);
    return {
      ok: true,
      data: await buildServerIpSnapshot(auth.supabase, auth.userId, rec),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setRotationThresholdAction(
  threshold: number,
): Promise<ActionResult<{ rotationThreshold: number }>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;

  const planPool = await resolveUserPlanIpPool(auth.supabase, auth.userId);
  if (!planPool.hasActivePlan) {
    return { ok: false, error: NO_ACTIVE_PLAN_IP_MESSAGE };
  }

  try {
    const n = await setRotationThreshold(auth.supabase, auth.userId, threshold);
    return { ok: true, data: { rotationThreshold: n } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
