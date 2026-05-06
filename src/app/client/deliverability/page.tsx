/**
 * Client deliverability help page.
 *
 * Why this exists:
 *   Outlook / Hotmail / Yahoo junking mail is rarely caused by something the
 *   platform can fix in code — sender reputation, SPF, DKIM, and DMARC live on
 *   the customer's domain. This page is the single source of truth we point
 *   customers to when they ask "why does my mail go to Junk?", with concrete
 *   per-SMTP-server actions instead of generic advice.
 */
import Link from "next/link";
import { ExternalLink, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SmtpRow = {
  id: string;
  label: string | null;
  provider: string | null;
  host: string;
  username: string;
};

type DomainGroup = {
  domain: string;
  /** Free-mail domains (gmail, yahoo, outlook) — heavy junk risk for bulk. */
  isFreeMail: boolean;
  servers: SmtpRow[];
};

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.co.in",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
]);

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  return email.slice(at + 1).trim().toLowerCase();
}

function groupByDomain(rows: SmtpRow[]): DomainGroup[] {
  const map = new Map<string, DomainGroup>();
  for (const r of rows) {
    const d = domainOf(r.username);
    if (!d) continue;
    const existing = map.get(d);
    if (existing) {
      existing.servers.push(r);
    } else {
      map.set(d, {
        domain: d,
        isFreeMail: FREE_MAIL_DOMAINS.has(d),
        servers: [r],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

export default async function ClientDeliverabilityPage() {
  let groups: DomainGroup[] = [];

  if (!isClientDashboardPreviewMode()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("smtp_servers")
      .select("id, label, provider, host, username")
      .eq("user_id", user.id);
    groups = groupByDomain((data ?? []) as SmtpRow[]);
  }

  const hasFreeMail = groups.some((g) => g.isFreeMail);
  const hasOwnDomain = groups.some((g) => !g.isFreeMail);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Deliverability</h1>
        <p className="text-muted-foreground">
          Why mail lands in Outlook / Gmail / Yahoo Junk, and the exact steps you
          need to take on your domain to fix it. The platform already sets every
          header that mailbox providers expect — the rest lives in DNS and on
          your sending account.
        </p>
      </header>

      {/* What the platform does for you ----------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-5 text-emerald-500" />
            What the platform already does for you
          </CardTitle>
          <CardDescription>
            Every send from your account ships these signals automatically — you
            don&apos;t need to configure anything to enable them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {[
              "Stable Message-ID using your From domain (so DKIM and DMARC alignment work)",
              "List-Unsubscribe header (mailto + HTTPS one-click) — RFC 2369 + RFC 8058",
              "Working /api/unsubscribe endpoint that suppresses recipients across future campaigns",
              "Auto-injected unsubscribe footer when your template doesn't ship one (CAN-SPAM)",
              "List-ID header for per-stream reputation (RFC 2919)",
              "Feedback-ID header so abuse reports map back to the campaign (RFC 6449)",
              "Precedence: bulk header — explicit signal to Outlook this is legitimate marketing mail",
              "Plain-text body auto-generated from your HTML so the MIME parts never drift",
              "Per-recipient X-Entity-Ref-ID for FBL / abuse triage",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Per-domain status ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your sending domains</CardTitle>
          <CardDescription>
            One row per domain in your SMTP list. If any row is highlighted, it
            is the most likely cause of mail landing in Junk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No SMTP servers added yet. Add one under{" "}
              <Link href="/client/smtp" className="underline">
                SMTP
              </Link>
              .
            </p>
          ) : (
            groups.map((g) => (
              <div
                key={g.domain}
                className={`rounded-lg border p-4 ${
                  g.isFreeMail ? "border-amber-500/50 bg-amber-500/5" : "border-zinc-800"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-mono text-sm">
                    {g.isFreeMail ? (
                      <AlertTriangle className="size-4 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    )}
                    {g.domain}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {g.servers.map((s) => (
                      <Badge key={s.id} variant="outline" className="font-mono text-xs">
                        {s.label || s.host}
                      </Badge>
                    ))}
                  </div>
                </div>
                {g.isFreeMail ? (
                  <p className="mt-2 text-sm text-amber-200/90">
                    <strong>Free-mail address detected.</strong> Microsoft / Outlook
                    aggressively junks bulk mail from <code>{g.domain}</code> because
                    you cannot publish DKIM or DMARC for a domain you don&apos;t own.
                    For real deliverability, switch to a domain you control (e.g.{" "}
                    <code>mail.your-company.com</code>) on a transactional relay like
                    Brevo, SendGrid, Postmark, Amazon SES, Mailgun, or Resend.
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Verify SPF, DKIM, and DMARC are published for{" "}
                    <code>{g.domain}</code> using the checklist below.
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Checklist --------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checklist (do this on your sending domain)</CardTitle>
          <CardDescription>
            Run through these one by one. Each step targets a specific reason
            mailbox providers junk mail. The links open in a new tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4 text-sm">
            <ChecklistItem
              n={1}
              priority={hasFreeMail ? "critical" : "low"}
              title="Use a domain you own — not @gmail.com / @yahoo.com / @outlook.com"
              body={
                <>
                  Outlook flags bulk mail from free-mail addresses by default. Buy
                  or use a domain you control (e.g. <code>mail.your-company.com</code>),
                  then connect it via a transactional SMTP relay. Free tiers ship
                  100–300 mails/day:{" "}
                  <ExtLink href="https://www.brevo.com">Brevo</ExtLink>,{" "}
                  <ExtLink href="https://sendgrid.com">SendGrid</ExtLink>,{" "}
                  <ExtLink href="https://postmarkapp.com">Postmark</ExtLink>,{" "}
                  <ExtLink href="https://aws.amazon.com/ses/">Amazon SES</ExtLink>,{" "}
                  <ExtLink href="https://www.mailgun.com">Mailgun</ExtLink>,{" "}
                  <ExtLink href="https://resend.com">Resend</ExtLink>.
                </>
              }
            />
            <ChecklistItem
              n={2}
              priority={hasOwnDomain ? "critical" : "high"}
              title="Publish SPF, DKIM, and DMARC TXT records on your domain"
              body={
                <>
                  Most relays walk you through these in their setup wizard. After
                  applying, send a test mail to a fresh address from{" "}
                  <ExtLink href="https://www.mail-tester.com">mail-tester.com</ExtLink>
                  {" "}— aim for <strong>9+/10</strong>. A DKIM signature aligned
                  with your From domain is the #1 thing Outlook uses to trust a
                  sender.
                  <br />
                  <span className="text-muted-foreground">
                    Generators:{" "}
                    <ExtLink href="https://easydmarc.com/tools/spf-record-generator">
                      SPF
                    </ExtLink>
                    {" · "}
                    <ExtLink href="https://easydmarc.com/tools/dkim-record-generator">
                      DKIM
                    </ExtLink>
                    {" · "}
                    <ExtLink href="https://easydmarc.com/tools/dmarc-record-generator">
                      DMARC
                    </ExtLink>
                  </span>
                </>
              }
            />
            <ChecklistItem
              n={3}
              priority="medium"
              title="Sign up for Microsoft SNDS + JMRP (free, Outlook-specific)"
              body={
                <>
                  <ExtLink href="https://sendersupport.olc.protection.outlook.com/snds/">
                    SNDS
                  </ExtLink>{" "}
                  shows you how Outlook sees your sending IP&apos;s reputation.{" "}
                  <ExtLink href="https://sendersupport.olc.protection.outlook.com/pm/">
                    JMRP (Junk Mail Reporting Program)
                  </ExtLink>{" "}
                  forwards every &quot;Mark as Junk&quot; click in Outlook back to
                  you so you can suppress complainers. Both are free and
                  Outlook-specific — no other provider has equivalents.
                </>
              }
            />
            <ChecklistItem
              n={4}
              priority="medium"
              title="Warm up the domain — start small, ramp gradually"
              body={
                <>
                  Outlook learns sender reputation per (IP + domain) over weeks. A
                  brand-new domain blasting 5,000 recipients on day one will get
                  junked even with perfect auth. Start at ~50–100 mails/day to{" "}
                  <em>engaged</em> contacts (people who opted in recently), grow
                  by ~50% per week. Use the platform&apos;s IP rotation pause
                  intervals to space sends out.
                </>
              }
            />
            <ChecklistItem
              n={5}
              priority="low"
              title="Configure MAILER_PUBLIC_URL on the platform"
              body={
                <>
                  This is on the platform operator, not you, but ask them to set{" "}
                  <code>MAILER_PUBLIC_URL</code> to the public origin of this app.
                  When set, the HTTPS one-click unsubscribe URL is added to every
                  send (RFC 8058) — required by Yahoo and Gmail bulk-sender rules
                  once you&apos;re shipping &gt; 5K mails/day.
                </>
              }
            />
            <ChecklistItem
              n={6}
              priority="low"
              title="Keep your list clean"
              body={
                <>
                  Hard-bounced and unengaged addresses tank reputation faster than
                  any content trigger. The platform already suppresses anyone who
                  clicks Unsubscribe — also remove addresses that never opened in
                  90 days, and never buy lists. Run new uploads through{" "}
                  <ExtLink href="https://www.zerobounce.net">ZeroBounce</ExtLink>{" "}
                  or{" "}
                  <ExtLink href="https://neverbounce.com">NeverBounce</ExtLink>{" "}
                  before importing to your CSV.
                </>
              }
            />
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick test — send to mail-tester.com</CardTitle>
          <CardDescription>
            The fastest way to see what&apos;s wrong with a specific From address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ol className="ml-5 list-decimal space-y-1">
            <li>
              Open{" "}
              <ExtLink href="https://www.mail-tester.com">mail-tester.com</ExtLink>{" "}
              and copy the disposable address shown there.
            </li>
            <li>
              Create a one-recipient campaign in this app using that address as
              the only recipient and send.
            </li>
            <li>
              Click <strong>&quot;Then check your score&quot;</strong>. You&apos;ll
              get a 0–10 rating with line-by-line reasons (missing SPF, missing
              DKIM, body issues, blacklist hits).
            </li>
            <li>
              Anything below 8 means the same mail will land in Junk for at least
              some Outlook recipients. Address the failing items and retest.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-blue-400 underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function ChecklistItem({
  n,
  priority,
  title,
  body,
}: {
  n: number;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  body: React.ReactNode;
}) {
  const tone =
    priority === "critical"
      ? "border-red-500/50 bg-red-500/5"
      : priority === "high"
        ? "border-orange-500/40 bg-orange-500/5"
        : priority === "medium"
          ? "border-zinc-700"
          : "border-zinc-800";
  const label =
    priority === "critical"
      ? "Critical"
      : priority === "high"
        ? "Important"
        : priority === "medium"
          ? "Recommended"
          : "Optional";
  const labelClass =
    priority === "critical"
      ? "text-red-400"
      : priority === "high"
        ? "text-orange-400"
        : priority === "medium"
          ? "text-zinc-300"
          : "text-zinc-500";
  return (
    <li className={`rounded-lg border p-4 ${tone}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
          {n}
        </span>
        <span className="font-semibold">{title}</span>
        <span className={`ml-auto text-xs uppercase tracking-wide ${labelClass}`}>
          {label}
        </span>
      </div>
      <div className="ml-8 text-sm text-zinc-300">{body}</div>
    </li>
  );
}
