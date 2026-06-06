"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { AwsOutboundIpMode } from "@/lib/aws-outbound-ip";
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
  expiresAt: string;
  rotationThreshold: number;
  defaultThreshold: number;
  maxThreshold: number;
  mode: AwsOutboundIpMode;
  rotationConfigured: boolean;
  autoRotateOnThreshold: boolean;
};

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
    const rec = await getOrCreateOutboundIp(auth.supabase, auth.userId);
    return {
      ok: true,
      data: {
        ip: rec.ip,
        expiresAt: rec.expiresAt,
        rotationThreshold: rec.rotationThreshold,
        defaultThreshold: DEFAULT_ROTATION_THRESHOLD,
        maxThreshold: MAX_ROTATION_THRESHOLD,
        mode: rec.mode,
        rotationConfigured: rec.rotationConfigured,
        autoRotateOnThreshold: !shouldManualPauseForIpRotation(),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function rotateServerIpAction(): Promise<ActionResult<ServerIpSnapshot>> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  try {
    const rec = await rotateOutboundIp(auth.supabase, auth.userId);
    return {
      ok: true,
      data: {
        ip: rec.ip,
        expiresAt: rec.expiresAt,
        rotationThreshold: rec.rotationThreshold,
        defaultThreshold: DEFAULT_ROTATION_THRESHOLD,
        maxThreshold: MAX_ROTATION_THRESHOLD,
        mode: rec.mode,
        rotationConfigured: rec.rotationConfigured,
        autoRotateOnThreshold: !shouldManualPauseForIpRotation(),
      },
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
  try {
    const n = await setRotationThreshold(auth.supabase, auth.userId, threshold);
    return { ok: true, data: { rotationThreshold: n } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
