/** Configurable anti-spam / trust-tier thresholds (env-backed, not hardcoded). */

function envInt(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function envFloat(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

/** Minimum meaningful word count in HTML body after strip (default 25). */
export function contentMinWordCount(): number {
  return envInt("CONTENT_MIN_WORD_COUNT", 25, 1);
}

/**
 * Minimum plain-text characters per kilobyte of attachment data (default 50).
 * e.g. 2 MB attachment → need at least ~100k chars at 50/KB — use lower default.
 * Default 10 chars per KB → 2MB needs ~20k chars (~3500 words).
 */
export function contentMinTextCharsPerAttachmentKb(): number {
  return envFloat("CONTENT_MIN_TEXT_CHARS_PER_ATTACHMENT_KB", 10, 0.01);
}

export function trustTierNewDailyLimit(): number {
  return envInt("TRUST_TIER_NEW_DAILY_LIMIT", 30, 1);
}

export function trustTierNewPeriodDays(): number {
  return envInt("TRUST_TIER_NEW_PERIOD_DAYS", 4, 1);
}

/** Bounce rate threshold (0–1). Default 2%. */
export function trustTierMaxBounceRate(): number {
  return envFloat("TRUST_TIER_MAX_BOUNCE_RATE", 0.02, 0);
}

/** Spam complaint rate threshold (0–1). Default 0.1%. */
export function trustTierMaxComplaintRate(): number {
  return envFloat("TRUST_TIER_MAX_COMPLAINT_RATE", 0.001, 0);
}

/** Severe thresholds → restricted tier. */
export function trustTierSevereBounceRate(): number {
  return envFloat("TRUST_TIER_SEVERE_BOUNCE_RATE", 0.05, 0);
}

export function trustTierSevereComplaintRate(): number {
  return envFloat("TRUST_TIER_SEVERE_COMPLAINT_RATE", 0.005, 0);
}

export function trustTierWarmingMultiplier(): number {
  return envInt("TRUST_TIER_WARMING_MULTIPLIER", 2, 2);
}

export function trustTierWarmingIntervalDays(): number {
  return envInt("TRUST_TIER_WARMING_INTERVAL_DAYS", 3, 1);
}

export function trustTierEstablishedDailyLimit(): number {
  return envInt("TRUST_TIER_ESTABLISHED_DAILY_LIMIT", 50_000, 1);
}

export function trustTierRestrictedDailyLimit(): number {
  return envInt("TRUST_TIER_RESTRICTED_DAILY_LIMIT", 5, 0);
}

/** Lookback window for bounce/complaint metrics (days). */
export function trustTierMetricsLookbackDays(): number {
  return envInt("TRUST_TIER_METRICS_LOOKBACK_DAYS", 30, 1);
}

export function contentRescoreMaxAttempts(): number {
  return envInt("CONTENT_RESCORE_MAX_ATTEMPTS", 5, 1);
}

export function contentRescoreWindowMinutes(): number {
  return envInt("CONTENT_RESCORE_WINDOW_MINUTES", 30, 1);
}
