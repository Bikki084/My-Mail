"use server";

import { headers } from "next/headers";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

type Ok = { ok: true };
type Err = { ok: false; error: string };

function getClientIp(h: Awaited<ReturnType<typeof headers>>): string | null {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = h.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  const cfIp = h.get("cf-connecting-ip");
  if (cfIp?.trim()) return cfIp.trim();
  return null;
}

async function insertEvent(eventType: "login" | "logout"): Promise<Ok | Err> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const h = await headers();
  const ip = getClientIp(h);
  const ua = h.get("user-agent");

  const { error } = await supabase.from("login_events").insert({
    user_id: user.id,
    event_type: eventType,
    ip_address: ip,
    user_agent: ua,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function recordLoginEvent() {
  return insertEvent("login");
}

export async function recordLogoutEvent() {
  return insertEvent("logout");
}
