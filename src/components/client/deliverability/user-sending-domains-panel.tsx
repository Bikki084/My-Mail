import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
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

type SmtpRow = {
  id: string;
  label: string | null;
  provider: string | null;
  host: string;
  username: string;
};

type DomainGroup = {
  domain: string;
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

/** Per-user SMTP domain status — kept dynamic while the guide body is cached. */
export async function UserSendingDomainsPanel() {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your sending domains</CardTitle>
        <CardDescription>
          One row per domain in your SMTP list. If any row is highlighted, it is the
          most likely cause of mail landing in Junk.
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
                  aggressively junks bulk mail from <code>{g.domain}</code> because you
                  cannot publish DKIM or DMARC for a domain you don&apos;t own. For real
                  deliverability, switch to a domain you control (e.g.{" "}
                  <code>mail.your-company.com</code>) on a transactional relay like Brevo,
                  SendGrid, Postmark, Amazon SES, Mailgun, or Resend.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Verify SPF, DKIM, and DMARC are published for <code>{g.domain}</code>{" "}
                  using the checklist below.
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
