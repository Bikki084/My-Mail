/**
 * Provider-agnostic inbound email events (bounces, blocks, spam reports).
 *
 * Configure your SMTP/ESP webhook to POST here:
 *   POST https://mailshooter.in/api/webhooks/email-events
 *
 * Optional headers:
 *   X-Webhook-Provider: sendgrid | generic
 *   X-Webhook-Secret: <EMAIL_WEBHOOK_SECRET>  (required when env is set)
 *
 * SendGrid: enable Event Webhook → select bounce, blocked, spam report, dropped.
 * Events include unique_args when sent via our SendGrid SMTP path.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  parseInboundEmailEvents,
  processInboundEmailEvents,
} from "@/lib/webhooks/process-email-events";

export const dynamic = "force-dynamic";

function verifyWebhookSecret(req: Request): boolean {
  const expected = (process.env.EMAIL_WEBHOOK_SECRET ?? "").trim();
  if (!expected) return true;

  const header =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return header === expected;
}

export async function GET() {
  const secretConfigured = Boolean((process.env.EMAIL_WEBHOOK_SECRET ?? "").trim());
  return NextResponse.json({
    ok: true,
    endpoint: "/api/webhooks/email-events",
    method: "POST",
    description: "Inbound bounce/spam webhook for SendGrid and other ESPs.",
    secretRequired: secretConfigured,
    sendgridEvents: ["bounce", "blocked", "spamreport", "dropped"],
  });
}

export async function POST(req: Request) {
  if (!verifyWebhookSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (e) {
    console.warn(
      `[api/webhooks/email-events] service role missing: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }

  const providerHint = req.headers.get("x-webhook-provider");
  const body = await req.json().catch(() => null);
  const events = parseInboundEmailEvents(body, providerHint);

  if (events.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, suppressed: 0, skipped: 0 });
  }

  const result = await processInboundEmailEvents(supabase, events);
  return NextResponse.json({ ok: true, ...result });
}
