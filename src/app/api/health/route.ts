import { NextResponse } from "next/server";

/** Lightweight probe for Nginx / uptime checks — must stay fast and allocation-free. */
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
