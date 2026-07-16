import { ExternalLink, ShieldCheck, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DnsSetupPanel } from "@/components/client/deliverability/dns-setup-panel";

type DeliverabilityGuideProps = {
  /** When true, elevates free-mail checklist priority (from dynamic domain panel). */
  hasFreeMail?: boolean;
  /** When true, elevates DNS auth checklist priority. */
  hasOwnDomain?: boolean;
};

/**
 * Static deliverability guide — identical for all users except optional priority hints.
 * Cached at the page level via `revalidate`.
 */
export function DeliverabilityGuide({
  hasFreeMail = false,
  hasOwnDomain = false,
}: DeliverabilityGuideProps) {
  return (
    <>
      <DnsSetupPanel />

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
              "Outlook/Hotmail recipients get transactional-style headers (no bulk/marketing signals)",
              "Plain-text body auto-generated from your HTML so the MIME parts never drift",
              "Per-recipient X-Entity-Ref-ID for FBL / abuse triage",
              "Optional in-process DKIM signing when DKIM_* env vars are set (aligned with your From domain)",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checklist (do this on your sending domain)</CardTitle>
          <CardDescription>
            Run through these one by one. Each step targets a specific reason mailbox
            providers junk mail. The links open in a new tab.
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
                  Outlook flags bulk mail from free-mail addresses by default. Buy or use a
                  domain you control (e.g. <code>mail.your-company.com</code>), then connect
                  it via a transactional SMTP relay. Free tiers ship 100–300 mails/day:{" "}
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
                  Most relays walk you through these in their setup wizard. After applying,
                  send a test mail to a fresh address from{" "}
                  <ExtLink href="https://www.mail-tester.com">mail-tester.com</ExtLink> — aim
                  for <strong>9+/10</strong>. A DKIM signature aligned with your From domain
                  is the #1 thing Outlook uses to trust a sender.
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
                  forwards every &quot;Mark as Junk&quot; click in Outlook back to you so you
                  can suppress complainers. Both are free and Outlook-specific — no other
                  provider has equivalents.
                </>
              }
            />
            <ChecklistItem
              n={4}
              priority="medium"
              title="Warm up the domain — start small, ramp gradually"
              body={
                <>
                  Outlook learns sender reputation per (IP + domain) over weeks. A brand-new
                  domain blasting 5,000 recipients on day one will get junked even with perfect
                  auth. Start at ~50–100 mails/day to <em>engaged</em> contacts (people who
                  opted in recently), grow by ~50% per week. Use the platform&apos;s IP rotation
                  pause intervals to space sends out.
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
                  <code>MAILER_PUBLIC_URL</code> to the public origin of this app. When set, the
                  HTTPS one-click unsubscribe URL is added to every send (RFC 8058) — required
                  by Yahoo and Gmail bulk-sender rules once you&apos;re shipping &gt; 5K
                  mails/day.
                </>
              }
            />
            <ChecklistItem
              n={6}
              priority="low"
              title="Keep your list clean"
              body={
                <>
                  Hard-bounced and unengaged addresses tank reputation faster than any content
                  trigger. The platform already suppresses anyone who clicks Unsubscribe — also
                  remove addresses that never opened in 90 days, and never buy lists. Run new
                  uploads through <ExtLink href="https://www.zerobounce.net">ZeroBounce</ExtLink>{" "}
                  or <ExtLink href="https://neverbounce.com">NeverBounce</ExtLink> before
                  importing to your CSV.
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
              <ExtLink href="https://www.mail-tester.com">mail-tester.com</ExtLink> and copy
              the disposable address shown there.
            </li>
            <li>
              Create a one-recipient campaign in this app using that address as the only
              recipient and send.
            </li>
            <li>
              Click <strong>&quot;Then check your score&quot;</strong>. You&apos;ll get a 0–10
              rating with line-by-line reasons (missing SPF, missing DKIM, body issues,
              blacklist hits).
            </li>
            <li>
              Anything below 8 means the same mail will land in Junk for at least some Outlook
              recipients. Address the failing items and retest.
            </li>
          </ol>
        </CardContent>
      </Card>
    </>
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
