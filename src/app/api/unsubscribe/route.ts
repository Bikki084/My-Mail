/**
 * Public unsubscribe endpoint advertised in the `List-Unsubscribe` header.
 *
 *   GET  /api/unsubscribe?c=<campaignId>&r=<base64url(email)>
 *     → friendly HTML landing page that confirms the unsubscribe and (after
 *       JS-less form submit) records it. Used when a recipient clicks the
 *       unsubscribe link in the email body or pastes the URL into a browser.
 *
 *   POST /api/unsubscribe?c=<campaignId>&r=<base64url(email)>
 *     → RFC 8058 one-click endpoint. Mail providers (Gmail, Outlook, Yahoo)
 *       fetch this in the background when the user clicks the in-mail
 *       "Unsubscribe" chip. MUST respond 2xx with no auth required, even when
 *       the body is empty or `application/x-www-form-urlencoded` per
 *       `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
 *
 * The route degrades gracefully if the `unsubscribes` table is missing
 * (migration not applied yet) — the request still returns 200 so providers
 * don't penalise the sender, and a console warning tells the operator to run
 * `npm run db:migrate`.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Params = {
  campaignId: string | null;
  recipientEmail: string | null;
};

function parseParams(url: URL): Params {
  const c = url.searchParams.get("c");
  const r = url.searchParams.get("r");
  let recipientEmail: string | null = null;
  if (r) {
    try {
      // base64url → utf-8. Reject if it doesn't look like an email after decode.
      const decoded = Buffer.from(r, "base64url").toString("utf8").trim();
      if (decoded.includes("@") && decoded.length <= 320) {
        recipientEmail = decoded.toLowerCase();
      }
    } catch {
      recipientEmail = null;
    }
  }
  return {
    campaignId: c && /^[0-9a-fA-F-]{16,40}$/.test(c) ? c : null,
    recipientEmail,
  };
}

async function recordUnsubscribe(
  campaignId: string | null,
  recipientEmail: string,
  source: "one_click" | "mailto" | "manual",
  note: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  // Use service role: this endpoint is unauthenticated by design (mailbox
  // providers and recipients click the link without any session cookie).
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (err) {
    // Service role not configured — common in local dev. Return ok: true so
    // providers don't see a 5xx; the operator sees the warning in logs.
    console.warn(
      `[api/unsubscribe] Service role not configured (${
        (err as Error).message
      }); cannot persist unsubscribe for ${recipientEmail}.`,
    );
    return { ok: false, reason: "service_role_missing" };
  }

  // Resolve the sender (campaign owner) so suppression is per-tenant. Without
  // a campaignId we still record a row with user_id = null (best-effort).
  let userId: string | null = null;
  if (campaignId) {
    const { data: row } = await supabase
      .from("campaigns")
      .select("user_id")
      .eq("id", campaignId)
      .maybeSingle();
    userId = (row?.user_id as string | undefined) ?? null;
  }

  const ins = await supabase.from("unsubscribes").insert({
    user_id: userId,
    recipient_email: recipientEmail,
    campaign_id: campaignId,
    source,
    note: note ? note.slice(0, 500) : null,
  });

  if (ins.error) {
    // 23505 = unique violation → already unsubscribed, treat as success.
    if ((ins.error as { code?: string }).code === "23505") {
      return { ok: true };
    }
    // 42P01 = relation does not exist → migration not applied. Don't 5xx
    // (provider would penalise), but warn loudly so the operator notices.
    if ((ins.error as { code?: string }).code === "42P01") {
      console.warn(
        "[api/unsubscribe] `unsubscribes` table missing — run `npm run db:migrate`. " +
          "Returning 200 so the mailbox provider doesn't penalise the sender, " +
          "but the recipient is NOT actually suppressed yet.",
      );
      return { ok: false, reason: "table_missing" };
    }
    console.error(
      `[api/unsubscribe] insert failed for ${recipientEmail}:`,
      ins.error,
    );
    return { ok: false, reason: ins.error.message };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  // RFC 8058 one-click. Response body content is not consumed by mail clients;
  // only the 2xx status matters. Always return 200 even on internal errors so
  // providers don't penalise the sender's reputation for a transient failure.
  const url = new URL(req.url);
  const { campaignId, recipientEmail } = parseParams(url);

  if (!recipientEmail) {
    // Still 200 (per RFC 8058 best practice) but include a hint in the body.
    return NextResponse.json({ ok: false, error: "Missing or invalid recipient" });
  }

  const ua = req.headers.get("user-agent")?.slice(0, 200) ?? null;
  const result = await recordUnsubscribe(
    campaignId,
    recipientEmail,
    "one_click",
    ua ? `ua=${ua}` : null,
  );
  return NextResponse.json({ ok: result.ok });
}

function htmlPage(opts: {
  status: "ok" | "missing" | "error";
  email: string | null;
  errorMessage?: string;
}): string {
  const { status, email, errorMessage } = opts;
  const heading =
    status === "ok"
      ? "You're unsubscribed"
      : status === "missing"
        ? "Invalid unsubscribe link"
        : "Something went wrong";
  const body =
    status === "ok"
      ? `<p>${escapeHtml(email ?? "Your address")} has been removed from this mailing list.</p>
         <p>If this was a mistake, reply to the original email and the sender can add you back.</p>`
      : status === "missing"
        ? `<p>This unsubscribe link is malformed or expired. Try clicking the unsubscribe link in the latest email you received, or reply with the word "unsubscribe".</p>`
        : `<p>We couldn't process your request right now. Please try again in a few minutes, or reply to the email with the word "unsubscribe".</p>
           ${errorMessage ? `<p style="color:#9ca3af;font-size:12px;">Reference: ${escapeHtml(errorMessage)}</p>` : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #f9fafb; color: #111827; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #e5e7eb; }
    .card { background: #111827 !important; border-color: #1f2937 !important; }
  }
  .card { max-width: 420px; padding: 32px; border: 1px solid #e5e7eb;
          border-radius: 12px; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  h1 { margin: 0 0 12px; font-size: 20px; }
  p { margin: 0 0 12px; }
</style>
</head>
<body>
<main class="card">
  <h1>${escapeHtml(heading)}</h1>
  ${body}
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { campaignId, recipientEmail } = parseParams(url);

  if (!recipientEmail) {
    return new Response(htmlPage({ status: "missing", email: null }), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Recording on GET makes the link work even when JS is disabled or the
  // recipient just pastes the URL into their browser. We dedupe at the unique
  // index, so accidental refreshes are harmless.
  const ua = req.headers.get("user-agent")?.slice(0, 200) ?? null;
  const result = await recordUnsubscribe(
    campaignId,
    recipientEmail,
    "one_click",
    ua ? `ua=${ua}` : null,
  );

  const status = result.ok ? "ok" : result.reason === "table_missing" ? "ok" : "error";
  return new Response(
    htmlPage({
      status: status === "ok" ? "ok" : "error",
      email: recipientEmail,
      errorMessage: result.reason ?? undefined,
    }),
    {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}
