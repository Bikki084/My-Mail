import type { TrustTier } from "@/lib/trust-tier/types";
import {
  trustTierEstablishedDailyLimit,
  trustTierMaxBounceRate,
  trustTierMaxComplaintRate,
  trustTierNewDailyLimit,
  trustTierNewPeriodDays,
  trustTierRestrictedDailyLimit,
  trustTierSevereBounceRate,
  trustTierSevereComplaintRate,
  trustTierWarmingIntervalDays,
  trustTierWarmingMultiplier,
} from "@/lib/anti-spam-config";

export type TrustMetrics = {
  bounceRate: number;
  complaintRate: number;
  sentCount: number;
  bouncedCount: number;
  complaintCount: number;
};

export type TrustTierProfileInput = {
  trustTier: TrustTier;
  trustDailySendLimit: number;
  createdAt: string;
  trustTierUpdatedAt: string;
};

export type TrustTierEvaluation = {
  tier: TrustTier;
  dailyLimit: number;
  reason: string;
  metrics: TrustMetrics;
  changed: boolean;
};

function daysBetween(fromIso: string, toMs: number): number {
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((toMs - t) / (24 * 60 * 60 * 1000));
}

export function metricsExceedThresholds(metrics: TrustMetrics): {
  severe: boolean;
  exceeded: boolean;
} {
  const severe =
    metrics.bounceRate >= trustTierSevereBounceRate() ||
    metrics.complaintRate >= trustTierSevereComplaintRate();
  const exceeded =
    severe ||
    metrics.bounceRate >= trustTierMaxBounceRate() ||
    metrics.complaintRate >= trustTierMaxComplaintRate();
  return { severe, exceeded };
}

/**
 * Pure tier transition logic — used by service layer and unit tests.
 */
export function evaluateTrustTierTransition(
  profile: TrustTierProfileInput,
  metrics: TrustMetrics,
  nowMs = Date.now(),
): TrustTierEvaluation {
  const daysSinceCreation = daysBetween(profile.createdAt, nowMs);
  const daysSinceTierUpdate = daysBetween(profile.trustTierUpdatedAt, nowMs);
  const { severe, exceeded } = metricsExceedThresholds(metrics);

  let tier = profile.trustTier;
  let dailyLimit = profile.trustDailySendLimit;
  let reason = "No change";
  let changed = false;

  if (exceeded) {
    if (severe) {
      tier = "restricted";
      dailyLimit = trustTierRestrictedDailyLimit();
      reason = `Severe deliverability metrics: bounce ${(metrics.bounceRate * 100).toFixed(2)}%, complaints ${(metrics.complaintRate * 100).toFixed(3)}%`;
    } else if (tier === "established") {
      tier = "warming";
      dailyLimit = Math.max(
        trustTierNewDailyLimit(),
        Math.floor(trustTierEstablishedDailyLimit() / trustTierWarmingMultiplier()),
      );
      reason = `Metrics exceeded thresholds: bounce ${(metrics.bounceRate * 100).toFixed(2)}%, complaints ${(metrics.complaintRate * 100).toFixed(3)}%`;
    } else {
      tier = "restricted";
      dailyLimit = trustTierRestrictedDailyLimit();
      reason = `Poor deliverability metrics: bounce ${(metrics.bounceRate * 100).toFixed(2)}%, complaints ${(metrics.complaintRate * 100).toFixed(3)}%`;
    }
    changed = tier !== profile.trustTier || dailyLimit !== profile.trustDailySendLimit;
    return { tier, dailyLimit, reason, metrics, changed };
  }

  const newPeriodDays = trustTierNewPeriodDays();
  const warmingInterval = trustTierWarmingIntervalDays();
  const establishedCeiling = trustTierEstablishedDailyLimit();
  const warmingMult = trustTierWarmingMultiplier();

  if (tier === "restricted") {
    reason = "Account remains restricted — contact support or improve metrics.";
    return { tier, dailyLimit, reason, metrics, changed: false };
  }

  if (daysSinceCreation < newPeriodDays || tier === "new") {
    tier = "new";
    dailyLimit = trustTierNewDailyLimit();
    if (daysSinceCreation >= newPeriodDays && !exceeded) {
      tier = "warming";
      dailyLimit = trustTierNewDailyLimit() * warmingMult;
      reason = `Initial ${newPeriodDays}-day period completed with good metrics — warming tier`;
      changed = true;
    } else {
      reason = `New account (${daysSinceCreation}/${newPeriodDays} days) — daily cap ${dailyLimit}`;
      changed = tier !== profile.trustTier || dailyLimit !== profile.trustDailySendLimit;
    }
    return { tier, dailyLimit, reason, metrics, changed };
  }

  if (tier === "warming") {
    if (daysSinceTierUpdate >= warmingInterval && dailyLimit < establishedCeiling) {
      const next = Math.min(establishedCeiling, dailyLimit * warmingMult);
      if (next > dailyLimit) {
        dailyLimit = next;
        reason = `Good metrics — daily limit increased to ${dailyLimit}`;
        changed = true;
      }
      if (dailyLimit >= establishedCeiling) {
        tier = "established";
        dailyLimit = establishedCeiling;
        reason = `Established tier — daily limit ${dailyLimit}`;
        changed = true;
      }
    } else {
      reason = `Warming tier — daily limit ${dailyLimit}`;
    }
    return { tier, dailyLimit, reason, metrics, changed };
  }

  // established
  tier = "established";
  dailyLimit = establishedCeiling;
  reason = `Established tier — daily limit ${dailyLimit}`;
  changed = tier !== profile.trustTier || dailyLimit !== profile.trustDailySendLimit;
  return { tier, dailyLimit, reason, metrics, changed };
}
