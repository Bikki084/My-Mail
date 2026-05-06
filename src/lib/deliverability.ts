/**
 * Per-message deliverability helpers (headers, footers, DKIM config).
 *
 * Why this exists:
 *
 *   Yahoo (Feb 2024) and Gmail bulk-sender requirements both lean heavily on:
 *   1. Authenticated sender domain (SPF + DKIM + DMARC alignment) — handled
 *      at DNS and at the SMTP relay; we expose optional in-process DKIM via
 *      env vars for self-hosted SMTP, but most relays already DKIM-sign.
 *   2. `List-Unsubscribe` header (RFC 2369) and, when sending > 5K/day, a
 *      one-click HTTPS unsubscribe per RFC 8058. We always set the mailto:
 *      form; the HTTPS form is added when `MAILER_PUBLIC_URL` is set.
 *   3. A clearly visible unsubscribe link in the body and a postal address
 *      (CAN-SPAM). We auto-append a small footer when one isn't already
 *      present so naïve templates still ship "spam-checker safe".
 *   4. Stable Message-ID using the From domain (Yahoo correlates Message-ID
 *      and SPF authority). We let Nodemailer generate one but force the
 *      domain to match `from` so it never falls back to `nodemailer.com`.
 *   5. Per-recipient `X-Entity-Ref-ID` so feedback-loop reports map back to
 *      a specific send (helps with manual abuse triage too).
 */
import crypto from "node:crypto";

export type DeliverabilityHeaderOptions = {
  campaignId: string;
  /** Sender's user_id — surfaced via `Feedback-ID` so reputation reports map back. */
  userId?: string | null;
  /**
   * Human stream name (e.g. "April newsletter"). Slugified into `List-ID` so
   * Outlook / Hotmail can group same-stream mail and learn per-stream reputation.
   */
  streamName?: string | null;
  recipientEmail: string;
  /** Full RFC-5322 From, e.g. `My Mail <user@example.com>`. */
  fromAddress: string;
  /**
   * If set, an HTTPS one-click unsubscribe URL is added to `List-Unsubscribe`
   * and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is included.
   * Configure via `MAILER_PUBLIC_URL` (e.g. `https://send.example.com`).
   */
  publicBaseUrl?: string | null;
  /**
   * Mailbox to receive `mailto:` unsubscribe replies. Defaults to the SMTP
   * user (which is the From mailbox). Override via `MAILER_UNSUBSCRIBE_MAILBOX`.
   */
  unsubscribeMailbox?: string | null;
};

export type DeliverabilityHeaders = {
  /** Pass-through to Nodemailer `headers` option. */
  headers: Record<string, string>;
  /** Pass-through to Nodemailer `replyTo` option. */
  replyTo: string;
  /** Pass-through to Nodemailer `messageId` option. */
  messageId: string;
  /** Convenience: the canonical mailto: unsubscribe used for the footer link. */
  unsubscribeMailto: string;
  /** Convenience: HTTPS unsubscribe URL when public base URL is configured. */
  unsubscribeUrl: string | null;
};

const ANGLE_RE = /<([^>]+)>/;

/** Parse `Name <addr@host>` or bare `addr@host` into the address part. */
export function extractAddress(rfcAddress: string): string {
  const m = ANGLE_RE.exec(rfcAddress);
  if (m && m[1]) return m[1].trim();
  return rfcAddress.trim();
}

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 0) return "";
  return address.slice(at + 1).trim().toLowerCase();
}

/** Slug-safe ASCII for use inside angle-bracketed header tokens (List-ID, etc.). */
function slugForHeader(s: string, fallback: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

/**
 * Build per-recipient headers, Reply-To, and Message-ID.
 *
 * The Message-ID is intentionally domain-aligned with the From address. Nodemailer
 * does this by default, but only when From contains a parseable domain; setting
 * it explicitly avoids edge cases where the domain extraction fails.
 *
 * Outlook / Hotmail-specific signals we set:
 *   - `Precedence: bulk`     — explicit "this is a marketing/bulk send"; Microsoft
 *     filters use this to keep legitimate bulk mail out of phishing buckets.
 *   - `List-ID` (RFC 2919)   — identifies the campaign stream so SmartScreen can
 *     learn per-stream reputation and the recipient's "Block Sender" works on
 *     the stream rather than the individual From address.
 *   - `Feedback-ID` (RFC 6449) — used by Gmail FBL and accepted (not penalised)
 *     by other ISPs; the campaign / user / stream / app tuple maps spam-flag
 *     reports back to the correct send.
 *   - `X-Mailer`             — clean app identification (helps support triage,
 *     does NOT affect spam scoring, but missing it is mildly suspicious).
 *   - `MIME-Version`         — Nodemailer adds this; we set it explicitly so the
 *     value is never missing on edge transports.
 */
export function buildDeliverabilityHeaders(
  opts: DeliverabilityHeaderOptions,
): DeliverabilityHeaders {
  const fromAddr = extractAddress(opts.fromAddress);
  const fromDomain = domainOf(fromAddr) || "localhost";
  const mailbox = (opts.unsubscribeMailbox ?? "").trim() || fromAddr;

  const refId = `${opts.campaignId}.${crypto
    .createHash("sha256")
    .update(`${opts.campaignId}:${opts.recipientEmail}`)
    .digest("hex")
    .slice(0, 16)}`;

  const messageId = `<${crypto.randomUUID()}@${fromDomain}>`;

  const unsubscribeSubject = `Unsubscribe ${opts.campaignId}`.slice(0, 60);
  const unsubscribeMailto = `mailto:${mailbox}?subject=${encodeURIComponent(
    unsubscribeSubject,
  )}`;

  const unsubscribeParts: string[] = [`<${unsubscribeMailto}>`];
  let unsubscribeUrl: string | null = null;
  // RFC 8058 requires HTTPS for the one-click POST endpoint, and pointing
  // Outlook at an unreachable / plain-http URL is worse than not advertising
  // one at all (the validator fetch fails and the sender's reputation drops).
  // Silently fall back to the mailto: form when MAILER_PUBLIC_URL is invalid.
  if (opts.publicBaseUrl) {
    const trimmed = opts.publicBaseUrl.trim().replace(/\/+$/, "");
    const isHttps = /^https:\/\//i.test(trimmed);
    const isLocal =
      /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(trimmed);
    if (isHttps && !isLocal) {
      const params = new URLSearchParams({
        c: opts.campaignId,
        r: Buffer.from(opts.recipientEmail).toString("base64url"),
      });
      unsubscribeUrl = `${trimmed}/api/unsubscribe?${params.toString()}`;
      unsubscribeParts.unshift(`<${unsubscribeUrl}>`);
    }
  }

  const streamSlug = slugForHeader(opts.streamName ?? "", "campaigns");
  // List-ID per RFC 2919 — `<stream-slug.from-domain>` plus a friendly label.
  const listIdLabel = (opts.streamName ?? "Campaigns").trim().slice(0, 80);
  const listId = `${listIdLabel} <${streamSlug}.${fromDomain}>`;

  // Feedback-ID per RFC 6449 — `<campaignSlug>:<userSlug>:<streamSlug>:mymail`
  // Each segment max ~64 chars, total <= 255 per spec.
  const userSlug = slugForHeader(String(opts.userId ?? ""), "anon").slice(0, 32);
  const campaignSlug = opts.campaignId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32);
  const feedbackId = `${campaignSlug}:${userSlug}:${streamSlug}:mymail`;

  const headers: Record<string, string> = {
    "MIME-Version": "1.0",
    "List-Unsubscribe": unsubscribeParts.join(", "),
    "List-ID": listId,
    "X-Entity-Ref-ID": refId,
    "X-Mailer": "MyMail SaaS (https://github.com/mymail-saas)",
    "Feedback-ID": feedbackId,
    // Tells Microsoft/Outlook this is bulk mail, not unauthenticated solicitation.
    // Microsoft explicitly documents respecting `Precedence: bulk`; Yahoo / Gmail
    // are neutral on it. Do NOT set this for transactional mail (password reset,
    // receipts) — but every send through this app is a campaign by definition.
    Precedence: "bulk",
  };
  if (unsubscribeUrl) {
    // RFC 8058: only valid when an HTTPS URL is present.
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return {
    headers,
    replyTo: fromAddr,
    messageId,
    unsubscribeMailto,
    unsubscribeUrl,
  };
}

/** True when the body already contains some kind of unsubscribe affordance. */
function hasUnsubscribeMention(body: string): boolean {
  if (!body) return false;
  return /unsubscrib|opt[-\s]?out|stop receiving/i.test(body);
}

/**
 * Append a minimal CAN-SPAM / Yahoo-friendly footer to HTML and text bodies.
 *
 * The footer is only added when the body doesn't already contain an
 * "unsubscribe"-like keyword, so templates that ship their own footer keep
 * full control over wording and styling.
 */
export function appendUnsubscribeFooter(args: {
  html: string;
  text: string;
  unsubscribeMailto: string;
  unsubscribeUrl: string | null;
  /** Optional postal address line for CAN-SPAM compliance. */
  postalAddress?: string | null;
}): { html: string; text: string } {
  const { html, text, unsubscribeMailto, unsubscribeUrl, postalAddress } = args;
  const unsubscribeLink = unsubscribeUrl ?? unsubscribeMailto;
  const postalLine = (postalAddress ?? "").trim();

  let outHtml = html;
  if (html && !hasUnsubscribeMention(html)) {
    const footerHtml = [
      '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">',
      postalLine
        ? `<div style="margin-bottom:6px;">${escapeHtml(postalLine)}</div>`
        : "",
      `<div>Don't want these emails? <a href="${escapeAttr(
        unsubscribeLink,
      )}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>.</div>`,
      "</div>",
    ]
      .filter(Boolean)
      .join("");
    outHtml = injectBeforeBodyClose(html, footerHtml);
  }

  let outText = text;
  if (text && !hasUnsubscribeMention(text)) {
    const footerText = [
      "",
      "---",
      postalLine ? postalLine : "",
      `Unsubscribe: ${unsubscribeLink}`,
    ]
      .filter((line) => line !== "")
      .join("\n");
    outText = `${text.replace(/\s+$/, "")}\n${footerText}\n`;
  }

  return { html: outHtml, text: outText };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/**
 * Insert `extra` immediately before `</body>` if present, otherwise append.
 * Keeps DOCTYPE/head/style intact for templates that ship a full document.
 */
function injectBeforeBodyClose(html: string, extra: string): string {
  const closeIdx = html.toLowerCase().lastIndexOf("</body>");
  if (closeIdx < 0) return html + extra;
  return html.slice(0, closeIdx) + extra + html.slice(closeIdx);
}

export type DkimConfig = {
  domainName: string;
  keySelector: string;
  privateKey: string;
};

/**
 * Read optional DKIM config from environment so users running their own SMTP
 * (e.g. Postfix without an opendkim sidecar) can sign in-process.
 *
 * Most public relays (Gmail SMTP, SendGrid, Mailgun, SES, Brevo) already
 * DKIM-sign on their side, so this is typically `null` in production and
 * that's fine.
 */
export function getDkimConfigFromEnv(): DkimConfig | null {
  const domain = (process.env.DKIM_DOMAIN ?? "").trim();
  const selector = (process.env.DKIM_KEY_SELECTOR ?? "").trim();
  const rawKey = process.env.DKIM_PRIVATE_KEY ?? "";
  if (!domain || !selector || !rawKey) return null;

  // Allow the key to be passed with literal `\n` (common in single-line env files).
  const privateKey = rawKey.includes("BEGIN") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  return { domainName: domain, keySelector: selector, privateKey };
}
