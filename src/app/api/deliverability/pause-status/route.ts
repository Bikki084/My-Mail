import { NextResponse } from "next/server";
import {
  formatDeliverabilityPauseMessage,
  getDeliverabilityPauseStatus,
} from "@/lib/deliverability-guard";

export const dynamic = "force-dynamic";

/** Public status for client UI — no auth required (no secrets exposed). */
export async function GET() {
  const status = await getDeliverabilityPauseStatus();
  return NextResponse.json({
    paused: status.paused,
    pausedUntil: status.pausedUntil,
    reason: status.reason,
    remainingMs: status.remainingMs,
    message: formatDeliverabilityPauseMessage(status),
  });
}
