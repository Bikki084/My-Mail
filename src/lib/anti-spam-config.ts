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

/** Block campaign create/send when heuristic spam risk is high (default on). */
export function contentSpamBlockHighRisk(): boolean {
  return process.env.CONTENT_SPAM_BLOCK_HIGH_RISK !== "0";
}

/** Also block medium risk at server (default off — advisory only). */
export function contentSpamBlockMediumRisk(): boolean {
  return process.env.CONTENT_SPAM_BLOCK_MEDIUM_RISK === "1";
}

/** Hard-bounce rate that pauses an in-flight campaign (0–1, default 5%). */
export function campaignBouncePauseRate(): number {
  return envFloat("CAMPAIGN_BOUNCE_PAUSE_RATE", 0.05, 0);
}

/** Min send+bounce attempts before campaign bounce pause can trigger. */
export function campaignBouncePauseMinAttempts(): number {
  return envInt("CAMPAIGN_BOUNCE_PAUSE_MIN_ATTEMPTS", 20, 5);
}

/** Require genuineness pass token before send (default on). */
export function contentGenuinenessGateEnabled(): boolean {
  return process.env.CONTENT_GENUINENESS_GATE_DISABLE !== "1";
}

/** Min distinct content tokens for "specific enough" body (default 8). */
export function genuinenessMinSpecificTokens(): number {
  return envInt("GENUINENESS_MIN_SPECIFIC_TOKENS", 8, 1);
}

/** Min Jaccard overlap (0–1) between body and attachment text (default 0.08). */
export function genuinenessAttachmentRelevanceMin(): number {
  return envFloat("GENUINENESS_ATTACHMENT_RELEVANCE_MIN", 0.08, 0);
}

/** Max share of body that may be generic template phrases (0–1, default 0.45). */
export function genuinenessMaxGenericPhraseShare(): number {
  return envFloat("GENUINENESS_MAX_GENERIC_PHRASE_SHARE", 0.45, 0);
}

/** Pass-token TTL minutes (default 60). */
export function genuinenessPassTokenTtlMinutes(): number {
  return envInt("GENUINENESS_PASS_TOKEN_TTL_MINUTES", 60, 5);
}

/** Flag noreply@-style senders as lower trust (default on). */
export function genuinenessFlagNoreplySender(): boolean {
  return process.env.GENUINENESS_FLAG_NOREPLY_SENDER !== "0";
}
