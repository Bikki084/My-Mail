import {
  campaignBouncePauseMinAttempts,
  campaignBouncePauseRate,
} from "@/lib/anti-spam-config";

/** Whether an in-flight campaign should pause due to hard-bounce rate. */
export function shouldPauseCampaignForBounceSpike(
  sent: number,
  hardBounces: number,
  opts?: { minAttempts?: number; maxRate?: number },
): boolean {
  const minAttempts = opts?.minAttempts ?? campaignBouncePauseMinAttempts();
  const maxRate = opts?.maxRate ?? campaignBouncePauseRate();
  const attempts = sent + hardBounces;
  if (attempts < minAttempts || hardBounces === 0) return false;
  return hardBounces / attempts >= maxRate;
}

export function formatCampaignBouncePauseMessage(
  sent: number,
  hardBounces: number,
  maxRate: number,
): string {
  const pct = ((hardBounces / Math.max(1, sent + hardBounces)) * 100).toFixed(1);
  const limitPct = (maxRate * 100).toFixed(0);
  return (
    `Campaign paused: hard bounce rate ${pct}% (${hardBounces} bounces / ${sent + hardBounces} attempts) ` +
    `exceeded ${limitPct}% limit. Fix your recipient list and resume after review.`
  ).slice(0, 2000);
}
