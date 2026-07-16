import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseReadCircuit } from "@/lib/circuit-breaker";

/**
 * Lightweight feed for the in-app progress monitor. Returns the user's most
 * recently-updated campaign in any "interesting" state (in-flight, paused,
 * just finished). The composer shell polls this every couple of seconds so it
 * can pop the IP-rotation modal mid-send and the success modal at the end
 * without the user having to refresh the Sending & Logs tab.
 */
const TERMINAL_GRACE_MINUTES = 30;

type ApiCampaign = {
  id: string;
  status: "queued" | "sending" | "paused" | "completed" | "failed";
  pauseReason: string | null;
  totalEmails: number;
  sentCount: number;
  failedCount: number;
  /** Live count from `sending_logs`, refreshed every poll so progress is accurate while sending. */
  sentSoFar: number;
  failedSoFar: number;
  currentOutboundIp: string | null;
  ipRotationThreshold: number | null;
  pausedAt: string | null;
  updatedAt: string;
  streamName: string;
  /** Filled by /api/campaigns/[id]/send + the worker when delivery throws. */
  lastError: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(
    Date.now() - TERMINAL_GRACE_MINUTES * 60 * 1000,
  ).toISOString();

  // Try the full SELECT first, but fall back to a "core" SELECT if a column is
  // missing. The previous failure mode was a 500 on every poll the moment a
  // migration was missing — which both broke the in-app progress monitor *and*
  // generated dozens of 500s/min in the dev console drowning the actual
  // delivery logs. Now the monitor degrades gracefully and the user can still
  // see status / sent count even when the schema lags the code.
  type Row = {
    id: string;
    status: string;
    pause_reason?: string | null;
    total_emails?: number | null;
    sent_count?: number | null;
    failed_count?: number | null;
    current_outbound_ip?: string | null;
    ip_rotation_threshold?: number | null;
    paused_at?: string | null;
    updated_at: string;
    stream_name?: string | null;
    last_error?: string | null;
  };

  let row: Row | null = null;
  let degradedReason: string | null = null;

  const fullSelect = await supabase
    .from("campaigns")
    .select(
      "id, status, pause_reason, total_emails, sent_count, failed_count, current_outbound_ip, ip_rotation_threshold, paused_at, updated_at, stream_name, last_error",
    )
    .eq("user_id", user.id)
    .or(
      `status.in.(queued,sending,paused),and(status.in.(completed,failed),updated_at.gte.${cutoff})`,
    )
    .order("updated_at", { ascending: false })
    .limit(1);

  if (fullSelect.error) {
    degradedReason = fullSelect.error.message;
    const coreSelect = await supabase
      .from("campaigns")
      .select(
        "id, status, total_emails, sent_count, failed_count, updated_at, stream_name",
      )
      .eq("user_id", user.id)
      .or(
        `status.in.(queued,sending,paused),and(status.in.(completed,failed),updated_at.gte.${cutoff})`,
      )
      .order("updated_at", { ascending: false })
      .limit(1);
    if (coreSelect.error) {
      // If even the core columns can't be read, return a structured 200 with
      // the error so the UI can show a helpful banner instead of an opaque 500.
      return NextResponse.json({
        campaign: null,
        schemaError:
          `Could not read campaigns: ${coreSelect.error.message}. ` +
          `This usually means a migration is missing — run \`npm run db:migrate\` or restart the dev server (auto-migrate runs on startup).`,
      });
    }
    row = (coreSelect.data?.[0] as Row | undefined) ?? null;
  } else {
    row = (fullSelect.data?.[0] as Row | undefined) ?? null;
  }

  if (!row) {
    return NextResponse.json({
      campaign: null,
      ...(degradedReason ? { schemaError: degradedReason } : {}),
    });
  }

  // Fetch live counts from `sending_logs`. While `status='sending'` the
  // `sent_count`/`failed_count` columns aren't bumped per message, so the
  // accurate progress for the modal comes from a count query against the log.
  let sentSoFar = Number(row.sent_count ?? 0);
  let failedSoFar = Number(row.failed_count ?? 0);
  let logsDegraded = false;

  try {
    if (!supabaseReadCircuit.isOpen()) {
      const [sentRes, failedRes] = await supabaseReadCircuit.execute(() =>
        Promise.all([
          supabase
            .from("sending_logs")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", row.id)
            .eq("status", "sent"),
          supabase
            .from("sending_logs")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", row.id)
            .in("status", ["failed", "bounced"]),
        ]),
      );
      if (sentRes.error || failedRes.error) {
        logsDegraded = true;
      } else {
        sentSoFar = Number(sentRes.count ?? row.sent_count ?? 0);
        failedSoFar = Number(failedRes.count ?? row.failed_count ?? 0);
      }
    } else {
      logsDegraded = true;
    }
  } catch {
    logsDegraded = true;
  }

  const ipThresholdRaw = row.ip_rotation_threshold;
  const payload: ApiCampaign = {
    id: row.id,
    status: row.status as ApiCampaign["status"],
    pauseReason: row.pause_reason ?? null,
    totalEmails: Number(row.total_emails ?? 0),
    sentCount: Number(row.sent_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    sentSoFar,
    failedSoFar,
    currentOutboundIp: row.current_outbound_ip ?? null,
    ipRotationThreshold:
      typeof ipThresholdRaw === "number" && Number.isFinite(ipThresholdRaw)
        ? ipThresholdRaw
        : null,
    pausedAt: row.paused_at ?? null,
    updatedAt: String(row.updated_at),
    streamName: String(row.stream_name ?? ""),
    lastError: row.last_error ?? null,
  };

  return NextResponse.json({
    campaign: payload,
    ...(degradedReason ? { schemaError: degradedReason } : {}),
    ...(logsDegraded ? { logsDegraded: true } : {}),
  });
}
