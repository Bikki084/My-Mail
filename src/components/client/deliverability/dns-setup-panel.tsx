"use client";

import * as React from "react";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  generateDeliverabilityDnsAction,
  getDeliverabilityStatusAction,
  type DeliverabilityStatus,
} from "@/app/actions/deliverability-dns";
import type { DeliverabilityDnsBundle } from "@/lib/dns-deliverability";

type DnsBundleResult = DeliverabilityDnsBundle & { envSnippet: string };

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 shrink-0 border-zinc-700"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          toast.success(`${label} copied`);
        });
      }}
    >
      <Copy className="size-3.5" />
      Copy
    </Button>
  );
}

export function DnsSetupPanel() {
  const [status, setStatus] = React.useState<DeliverabilityStatus | null>(null);
  const [domain, setDomain] = React.useState("");
  const [dmarcEmail, setDmarcEmail] = React.useState("");
  const [smtpInclude, setSmtpInclude] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [bundle, setBundle] = React.useState<DnsBundleResult | null>(null);

  React.useEffect(() => {
    void getDeliverabilityStatusAction().then((res) => {
      if (res.ok) {
        setStatus(res.data);
        const own = res.data.smtpDomains.find(
          (d) =>
            ![
              "gmail.com",
              "yahoo.com",
              "outlook.com",
              "hotmail.com",
              "aol.com",
            ].includes(d),
        );
        if (own) setDomain(own);
      }
      setLoading(false);
    });
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    const res = await generateDeliverabilityDnsAction({
      domain,
      dmarcReportEmail: dmarcEmail || undefined,
      smtpInclude: smtpInclude || undefined,
    });
    setGenerating(false);
    if (!res.ok) {
      toast.error("Could not generate DNS records", { description: res.error });
      return;
    }
    setBundle(res.data);
    toast.success("DNS records generated", {
      description: "Publish the TXT records at your domain registrar, then add the .env snippet on the VPS.",
    });
  }

  return (
    <Card className="border-emerald-500/20 bg-emerald-950/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-5 text-emerald-400" />
          SPF · DKIM · DMARC setup (inbox boost)
        </CardTitle>
        <CardDescription>
          Generate DNS records and DKIM keys for a domain you own. After publishing DNS and
          adding the env vars on your server, every campaign is DKIM-signed automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="size-4 animate-spin" />
            Checking deliverability status…
          </p>
        ) : status ? (
          <ul className="space-y-1 text-sm">
            <li className={status.dkimConfigured ? "text-emerald-300" : "text-amber-200"}>
              DKIM signing: {status.dkimConfigured ? `active (${status.dkimDomain})` : "not configured on server"}
            </li>
            <li className={status.mailerPublicUrl ? "text-emerald-300" : "text-amber-200"}>
              HTTPS unsubscribe URL:{" "}
              {status.mailerPublicUrl ?? "not set (add MAILER_PUBLIC_URL or NEXT_PUBLIC_APP_URL)"}
            </li>
            {status.recommendations.map((line) => (
              <li key={line} className="text-zinc-400">
                → {line}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="dns-domain">Your sending domain</Label>
            <Input
              id="dns-domain"
              placeholder="mail.yourcompany.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dmarc-email">DMARC reports (optional)</Label>
            <Input
              id="dmarc-email"
              placeholder="dmarc@yourcompany.com"
              value={dmarcEmail}
              onChange={(e) => setDmarcEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="spf-include">SPF include (optional)</Label>
            <Input
              id="spf-include"
              placeholder="sendgrid.net or amazonses.com"
              value={smtpInclude}
              onChange={(e) => setSmtpInclude(e.target.value)}
            />
          </div>
        </div>

        <Button
          type="button"
          disabled={generating || !domain.trim()}
          onClick={() => void handleGenerate()}
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Generate SPF, DKIM &amp; DMARC records
        </Button>

        {bundle ? (
          <div className="space-y-4 border-t border-zinc-800 pt-4">
            <p className="text-sm font-medium text-zinc-200">
              Step 1 — Add these TXT records at your domain DNS host
            </p>
            {bundle.records.map((rec) => (
              <div
                key={rec.host + rec.value.slice(0, 24)}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-zinc-500">TXT</span>
                  <CopyButton text={rec.value} label="Record value" />
                </div>
                <p className="font-mono text-xs text-emerald-200/90 break-all">{rec.host}</p>
                <p className="font-mono text-xs text-zinc-300 break-all whitespace-pre-wrap">
                  {rec.value}
                </p>
                {rec.note ? <p className="text-xs text-zinc-500">{rec.note}</p> : null}
              </div>
            ))}

            <p className="text-sm font-medium text-zinc-200">
              Step 2 — Add to <code className="text-emerald-300">.env.local</code> on the VPS
            </p>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
              <div className="flex justify-end">
                <CopyButton text={bundle.envSnippet} label="Env snippet" />
              </div>
              <pre className="overflow-x-auto font-mono text-xs text-zinc-300 whitespace-pre-wrap">
                {bundle.envSnippet}
              </pre>
            </div>

            <p className="text-sm text-zinc-400">
              Step 3 — <code>npm run build && pm2 restart all</code>, then send a test to{" "}
              <a
                href="https://www.mail-tester.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline"
              >
                mail-tester.com
              </a>{" "}
              and aim for 9+/10.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
