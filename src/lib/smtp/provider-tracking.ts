/**
 * Per-provider outbound metadata so inbound webhooks can map bounces back to
 * the sender tenant. Provider-agnostic fallbacks use X-Mymail-* headers.
 */
export function providerTrackingHeaders(
  smtpHost: string,
  opts: { campaignId: string; userId: string },
): Record<string, string> {
  const host = smtpHost.trim().toLowerCase();
  const base: Record<string, string> = {
    "X-Mymail-Campaign-Id": opts.campaignId,
    "X-Mymail-User-Id": opts.userId,
  };

  if (host.includes("sendgrid")) {
    return {
      ...base,
      "X-SMTPAPI": JSON.stringify({
        unique_args: {
          campaign_id: opts.campaignId,
          user_id: opts.userId,
        },
      }),
    };
  }

  return base;
}
