"use server";

import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  buildDeliverabilityDnsBundle,
  dkimPrivateKeyForEnv,
  type DeliverabilityDnsBundle,
} from "@/lib/dns-deliverability";
import { fetchLightsailPoolIpv4List, isAwsLightsailRotationConfigured } from "@/lib/aws-outbound-ip";
import { getDkimConfigFromEnv, isDkimConfigured } from "@/lib/deliverability";
import { isMailerPublicUrlConfigured, resolveMailerPublicBaseUrl } from "@/lib/mailer-public-url";
import { domainOfEmail, isFreeMailDomain } from "@/lib/mailbox-domains";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type DeliverabilityStatus = {
  smtpDomains: string[];
  hasFreeMailSender: boolean;
  dkimConfigured: boolean;
  dkimDomain: string | null;
  mailerPublicUrl: string | null;
  sendingIpv4: string[];
  recommendations: string[];
};

export async function getDeliverabilityStatusAction(): Promise<
  ActionResult<DeliverabilityStatus>
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const { data: smtpRows } = await supabase
    .from("smtp_servers")
    .select("username")
    .eq("user_id", user.id);

  const smtpDomains = [
    ...new Set(
      (smtpRows ?? [])
        .map((r) => domainOfEmail(String(r.username ?? "")))
        .filter(Boolean),
    ),
  ];

  let sendingIpv4: string[] = [];
  if (isAwsLightsailRotationConfigured()) {
    try {
      sendingIpv4 = await fetchLightsailPoolIpv4List();
    } catch {
      sendingIpv4 = [];
    }
  }

  const dkim = getDkimConfigFromEnv();
  const hasFreeMailSender = smtpDomains.some((d) => isFreeMailDomain(d));
  const mailerPublicUrl = resolveMailerPublicBaseUrl();

  const recommendations: string[] = [];
  if (hasFreeMailSender) {
    recommendations.push(
      "Switch From address to a domain you own (not @gmail.com / @yahoo.com). Free-mail From addresses cannot pass DKIM/DMARC alignment and land in Spam.",
    );
  }
  if (!isDkimConfigured()) {
    recommendations.push(
      "Generate DKIM keys below, publish the DNS TXT record, and add DKIM_* vars to .env.local on the server — the app will sign every outbound message.",
    );
  }
  if (!isMailerPublicUrlConfigured()) {
    recommendations.push(
      "Set MAILER_PUBLIC_URL (HTTPS) or NEXT_PUBLIC_APP_URL to your public site URL so Gmail/Yahoo get a one-click unsubscribe link.",
    );
  }
  if (sendingIpv4.length > 0) {
    recommendations.push(
      `Add all ${sendingIpv4.length} sending IP(s) to your SPF record (generated below).`,
    );
  }

  return {
    ok: true,
    data: {
      smtpDomains,
      hasFreeMailSender,
      dkimConfigured: isDkimConfigured(),
      dkimDomain: dkim?.domainName ?? null,
      mailerPublicUrl,
      sendingIpv4,
      recommendations,
    },
  };
}

export async function generateDeliverabilityDnsAction(input: {
  domain: string;
  dmarcReportEmail?: string;
  smtpInclude?: string;
}): Promise<
  ActionResult<
    DeliverabilityDnsBundle & {
      envSnippet: string;
    }
  >
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required." };

  const domain = input.domain.trim().toLowerCase();
  if (!domain || domain.includes("@")) {
    return { ok: false, error: "Enter a valid domain (e.g. mail.yourcompany.com)." };
  }
  if (isFreeMailDomain(domain)) {
    return {
      ok: false,
      error: "You cannot publish DKIM/DMARC for gmail.com, yahoo.com, etc. Use a domain you purchased.",
    };
  }

  let sendingIpv4: string[] = [];
  if (isAwsLightsailRotationConfigured()) {
    try {
      sendingIpv4 = await fetchLightsailPoolIpv4List();
    } catch {
      /* optional */
    }
  }

  const include = input.smtpInclude
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const bundle = buildDeliverabilityDnsBundle({
      domain,
      sendingIpv4,
      smtpInclude: include,
      dmarcReportEmail: input.dmarcReportEmail?.trim() || null,
      generateDkim: true,
    });

    const envSnippet = bundle.dkim
      ? [
          `# Add to .env.local on the VPS, then: npm run build && pm2 restart all`,
          `DKIM_DOMAIN=${bundle.domain}`,
          `DKIM_KEY_SELECTOR=${bundle.dkim.selector}`,
          `DKIM_PRIVATE_KEY=${dkimPrivateKeyForEnv(bundle.dkim.privateKeyPem)}`,
          `MAILER_PUBLIC_URL=https://${bundle.domain}`,
          `MAILER_POSTAL_ADDRESS=Your Company, Street, City, State ZIP, Country`,
        ].join("\n")
      : "";

    return { ok: true, data: { ...bundle, envSnippet } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
