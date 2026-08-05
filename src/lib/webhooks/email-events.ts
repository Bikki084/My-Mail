/**
 * Provider-agnostic inbound email event types (bounces, blocks, spam).
 * Adapters map each SMTP/ESP webhook payload into these normalized events.
 */

export type NormalizedEmailEvent = {
  provider: string;
  eventType:
    | "hard_bounce"
    | "soft_bounce"
    | "blocked"
    | "spam_report"
    | "dropped"
    | "deferred"
    | "other";
  recipientEmail: string;
  userId: string | null;
  campaignId: string | null;
  /** Raw provider event for audit storage. */
  raw: Record<string, unknown>;
};

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return s.includes("@") ? s : null;
}

function readUniqueArg(
  event: Record<string, unknown>,
  key: string,
): string | null {
  const args = event.unique_args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const v = (args as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const custom = event.custom_args;
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    const v = (custom as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function mapSendGridEventType(
  eventName: string,
  typeField: string | null,
  classification: string | null,
): NormalizedEmailEvent["eventType"] {
  const ev = eventName.toLowerCase();
  if (ev === "spamreport" || ev === "spam_report") return "spam_report";
  if (ev === "blocked") return "blocked";
  if (ev === "dropped") return "dropped";
  if (ev === "deferred") return "deferred";
  if (ev === "bounce") {
    const cls = (classification ?? typeField ?? "").toLowerCase();
    if (cls.includes("invalid") || cls.includes("hard") || typeField === "bounce") {
      return "hard_bounce";
    }
    return "soft_bounce";
  }
  return "other";
}

/**
 * Parse SendGrid Event Webhook POST body (JSON array).
 * Docs: https://docs.sendgrid.com/for-developers/tracking-events/event
 */
export function parseSendGridEvents(body: unknown): NormalizedEmailEvent[] {
  if (!Array.isArray(body)) return [];
  const out: NormalizedEmailEvent[] = [];

  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const event = item as Record<string, unknown>;
    const email = normalizeEmail(event.email);
    if (!email) continue;

    const eventName = String(event.event ?? "");
    const typeField = typeof event.type === "string" ? event.type : null;
    const classification =
      typeof event.bounce_classification === "string"
        ? event.bounce_classification
        : null;

    const eventType = mapSendGridEventType(eventName, typeField, classification);
    if (eventType === "other") continue;

    out.push({
      provider: "sendgrid",
      eventType,
      recipientEmail: email,
      userId: readUniqueArg(event, "user_id"),
      campaignId: readUniqueArg(event, "campaign_id"),
      raw: event,
    });
  }

  return out;
}

/** Generic adapter: X-Mymail-* headers echoed in some relay webhooks. */
export function parseGenericEvents(
  body: unknown,
  provider: string,
): NormalizedEmailEvent[] {
  const rows = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  const out: NormalizedEmailEvent[] = [];

  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const event = item as Record<string, unknown>;
    const email = normalizeEmail(event.recipient ?? event.email ?? event.to);
    if (!email) continue;

    const typeRaw = String(event.event_type ?? event.event ?? event.type ?? "").toLowerCase();
    let eventType: NormalizedEmailEvent["eventType"] = "other";
    if (/spam|complaint|abuse/.test(typeRaw)) eventType = "spam_report";
    else if (/hard.?bounce|permanent|invalid/.test(typeRaw)) eventType = "hard_bounce";
    else if (/soft.?bounce|temporary/.test(typeRaw)) eventType = "soft_bounce";
    else if (/block/.test(typeRaw)) eventType = "blocked";
    else if (/drop/.test(typeRaw)) eventType = "dropped";
    else if (/defer/.test(typeRaw)) eventType = "deferred";
    else if (/bounce/.test(typeRaw)) eventType = "hard_bounce";

    if (eventType === "other") continue;

    const userId =
      typeof event.user_id === "string"
        ? event.user_id
        : typeof event.userId === "string"
          ? event.userId
          : null;
    const campaignId =
      typeof event.campaign_id === "string"
        ? event.campaign_id
        : typeof event.campaignId === "string"
          ? event.campaignId
          : null;

    out.push({
      provider,
      eventType,
      recipientEmail: email,
      userId,
      campaignId,
      raw: event,
    });
  }

  return out;
}

export function shouldAutoSuppress(eventType: NormalizedEmailEvent["eventType"]): boolean {
  return (
    eventType === "hard_bounce" ||
    eventType === "soft_bounce" ||
    eventType === "blocked" ||
    eventType === "spam_report" ||
    eventType === "dropped"
  );
}

export function suppressionSourceFromEvent(
  eventType: NormalizedEmailEvent["eventType"],
): "hard_bounce" | "soft_bounce" | "blocked" | "spam_report" {
  switch (eventType) {
    case "spam_report":
      return "spam_report";
    case "blocked":
      return "blocked";
    case "soft_bounce":
      return "soft_bounce";
    default:
      return "hard_bounce";
  }
}
