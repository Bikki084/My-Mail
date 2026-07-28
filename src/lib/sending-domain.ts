import { APP_DOMAIN } from "@/lib/brand";

/** Verified sending domain for From addresses and DKIM alignment. */
export function resolveSendingDomain(): string {
  const raw = process.env.DKIM_DOMAIN?.trim().replace(/\.$/, "").replace(/^@/, "");
  if (raw && !raw.includes("@")) return raw;
  return APP_DOMAIN;
}
