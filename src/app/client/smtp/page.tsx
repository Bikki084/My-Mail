import Link from "next/link";
import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { SmtpForm } from "@/components/client/email-campaign/smtp-form";

export default function ClientSmtpPage() {
  const previewMode = isClientDashboardPreviewMode();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SMTP servers</h1>
        <p className="text-muted-foreground">
          Add Gmail, Yahoo, Outlook, or a custom relay (e.g. Postfix on this VPS at{" "}
          <code className="text-sm">127.0.0.1:25</code> with{" "}
          <code className="text-sm">noreply@bulkfirepro.com</code>). Saved accounts rotate
          per campaign. For the full send flow, open{" "}
          <Link href="/client" className="text-emerald-400 underline underline-offset-2">
            Email Campaign
          </Link>
          .
        </p>
      </div>

      <SmtpForm previewMode={previewMode} />
    </div>
  );
}
