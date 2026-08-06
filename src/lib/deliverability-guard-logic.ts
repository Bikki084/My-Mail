import type { DeliverabilitySignal } from "@/lib/deliverability-guard-types";

/** Points per signal — composite score trips before individual limits in some cases. */
export const DELIVERABILITY_SIGNAL_WEIGHTS: Record<DeliverabilitySignal, number> = {
  spam_report: 10,
  esp_account_risk: 15,
  smtp_spam_reject: 8,
  blocked: 6,
  dropped: 4,
  hard_bounce: 3,
  soft_bounce: 1,
  deferred: 1,
};

export function compositePauseThreshold(): number {
  const raw = process.env.DELIVERABILITY_COMPOSITE_THRESHOLD;
  if (raw == null || raw.trim() === "") return 12;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

export function signalWindowMinutes(): number {
  const raw = process.env.DELIVERABILITY_SIGNAL_WINDOW_MINUTES;
  if (raw == null || raw.trim() === "") return 60;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export function perSignalThresholds(): Record<DeliverabilitySignal, number> {
  function envInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw == null || raw.trim() === "") return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  }

  return {
    // Aggressive defaults — pause before ESP account suspension.
    spam_report: envInt("DELIVERABILITY_SPAM_REPORT_THRESHOLD", 1),
    blocked: envInt("DELIVERABILITY_BLOCKED_THRESHOLD", 2),
    hard_bounce: envInt("DELIVERABILITY_HARD_BOUNCE_THRESHOLD", 5),
    soft_bounce: envInt("DELIVERABILITY_SOFT_BOUNCE_THRESHOLD", 12),
    deferred: envInt("DELIVERABILITY_DEFERRED_THRESHOLD", 15),
    dropped: envInt("DELIVERABILITY_DROPPED_THRESHOLD", 3),
    smtp_spam_reject: envInt("DELIVERABILITY_SMTP_SPAM_REJECT_THRESHOLD", 2),
    esp_account_risk: envInt("DELIVERABILITY_ESP_ACCOUNT_RISK_THRESHOLD", 1),
  };
}

export function computeCompositeScore(
  counts: Partial<Record<DeliverabilitySignal, number>>,
): number {
  let total = 0;
  for (const [signal, weight] of Object.entries(DELIVERABILITY_SIGNAL_WEIGHTS)) {
    const n = counts[signal as DeliverabilitySignal] ?? 0;
    total += n * weight;
  }
  return total;
}

export function shouldTripCompositePause(score: number): boolean {
  return score >= compositePauseThreshold();
}

/** Classify SMTP failure text for reputation guard signals. */
export function classifySmtpErrorForGuard(message: string): DeliverabilitySignal | null {
  const m = message.toLowerCase();

  if (
    /account.{0,40}(suspended|disabled|locked|terminated)|sending.{0,20}(disabled|suspended)|mail sending.{0,20}disabled|reputation.{0,30}(issue|problem|violation)|flagged for review|compliance review|abuse.{0,20}detected|service not available.{0,20}account/.test(
      m,
    )
  ) {
    return "esp_account_risk";
  }

  if (
    /spam|junk folder|unsolicited|blacklist|block list|reputation|5\.7\.1|5\.7\.0|554|policy reject|content rejected|abuse|complaint/.test(
      m,
    )
  ) {
    return "smtp_spam_reject";
  }

  if (
    /bounce|550 5\.1|551|552|553|user unknown|mailbox unavailable|does not exist|invalid recipient/.test(
      m,
    )
  ) {
    return "hard_bounce";
  }

  return null;
}

export function mapWebhookEventToSignal(eventType: string): DeliverabilitySignal | null {
  switch (eventType) {
    case "spam_report":
      return "spam_report";
    case "blocked":
      return "blocked";
    case "hard_bounce":
      return "hard_bounce";
    case "soft_bounce":
      return "soft_bounce";
    case "dropped":
      return "dropped";
    case "deferred":
      return "deferred";
    default:
      return null;
  }
}

export function formatPlatformFreezeReason(input: {
  signal?: DeliverabilitySignal;
  count?: number;
  limit?: number;
  compositeScore?: number;
  compositeLimit?: number;
  detail?: string;
}): string {
  const window = signalWindowMinutes();
  if (input.signal && input.count != null && input.limit != null) {
    const base = `${input.count} ${input.signal.replace(/_/g, " ")} signal(s) in the last ${window} minutes (limit ${input.limit})`;
    return input.detail ? `${base} — ${input.detail}` : base;
  }
  if (input.compositeScore != null && input.compositeLimit != null) {
    const base = `Composite deliverability score ${input.compositeScore} in the last ${window} minutes (limit ${input.compositeLimit}) — sending frozen to protect the ESP account`;
    return input.detail ? `${base} — ${input.detail}` : base;
  }
  return input.detail ?? "Deliverability guard triggered";
}
