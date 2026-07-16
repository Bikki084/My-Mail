/**
 * Client deliverability help page.
 *
 * Static guide content is cached (see `revalidate`); per-user SMTP domains load
 * in a dynamic fragment via Suspense.
 */
import { Suspense } from "react";
import { DeliverabilityGuide } from "@/components/client/deliverability/deliverability-guide";
import { UserSendingDomainsPanel } from "@/components/client/deliverability/user-sending-domains-panel";

/** Regenerate static guide shell hourly; domain panel stays per-request. */
export const revalidate = 3600;

function DomainsSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="mb-2 h-5 w-48 rounded bg-zinc-800" />
      <div className="h-4 w-full max-w-md rounded bg-zinc-800/80" />
    </div>
  );
}

export default function ClientDeliverabilityPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Deliverability</h1>
        <p className="text-muted-foreground">
          Why mail lands in Outlook / Gmail / Yahoo Junk, and the exact steps you need to
          take on your domain to fix it. The platform already sets every header that mailbox
          providers expect — the rest lives in DNS and on your sending account.
        </p>
      </header>

      <DeliverabilityGuide />

      <Suspense fallback={<DomainsSkeleton />}>
        <UserSendingDomainsPanel />
      </Suspense>
    </div>
  );
}
