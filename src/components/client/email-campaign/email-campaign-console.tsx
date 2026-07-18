"use client";

import * as React from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WalletPlanTab } from "./wallet-plan-tab";
import type { WalletState } from "@/app/actions/wallet";
import { CsvRecipientsTab } from "./csv-table";
import { SmtpForm } from "./smtp-form";
import dynamic from "next/dynamic";
import { SendingLogsTab } from "./logs-table";

/** Lazy-load composer so Monaco never lands in the initial /client bundle. */
const EmailEditor = dynamic(
  () =>
    import("./email-editor").then((m) => ({ default: m.EmailEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-sm text-zinc-500">
        Loading Email Composer…
      </div>
    ),
  },
);
import { UserProfile } from "./user-profile";
import { AnnouncementBell } from "@/components/client/announcements/announcement-bell";
import { useAnnouncementsSnapshot } from "@/components/client/announcements/announcements-context";
import { EmailCampaignProvider } from "./email-campaign-context";
import { WalletStateProvider } from "./wallet-state-context";
import { PlanCountdownHeader } from "./plan-countdown-header";
import { CampaignProgressMonitor } from "./campaign-progress-monitor";
import { APP_BRAND_NAME } from "@/lib/brand";

const TAB_VALUES = [
  { value: "wallet", label: "Wallet & Plan" },
  { value: "recipients", label: "Recipients (CSV Upload)" },
  { value: "smtp", label: "SMTP Configuration" },
  { value: "composer", label: "Email Composer" },
  { value: "logs", label: "Sending & Logs" },
] as const;

const EMPTY_WALLET_STATE: WalletState = { balance: 0, activePlan: null };

export function EmailCampaignConsole({
  userDisplayName = "Bikki Shaw",
  walletState = EMPTY_WALLET_STATE,
  previewMode = false,
}: {
  userDisplayName?: string;
  walletState?: WalletState;
  previewMode?: boolean;
}) {
  const {
    all: announcementsAll,
    unread: announcementsUnread,
    userId: announcementsUserId,
  } = useAnnouncementsSnapshot();
  const [activeTab, setActiveTab] = React.useState("wallet");
  const persistKey = previewMode ? null : announcementsUserId;

  return (
    <EmailCampaignProvider persistenceUserId={persistKey}>
    <WalletStateProvider initial={walletState}>
    <CampaignProgressMonitor previewMode={previewMode} />
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8 lg:py-10">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <Link
              href="/client"
              className="group flex shrink-0 items-center gap-0 rounded-xl outline-none ring-zinc-600 focus-visible:ring-2"
              aria-label={`${APP_BRAND_NAME} — Email Campaign home`}
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-md shadow-violet-950/40 ring-1 ring-white/10 transition group-hover:brightness-110">
                <Mail className="size-[1.125rem] text-white" strokeWidth={2} />
              </span>
            </Link>
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-zinc-50 md:text-3xl">
              Email Campaign System
            </h1>
          </div>
          <div className="flex min-w-0 flex-shrink-0 items-center justify-end gap-1">
            <PlanCountdownHeader previewMode={previewMode} />
            {!previewMode && (
              <AnnouncementBell
                initialAll={announcementsAll}
                initialUnread={announcementsUnread}
                userId={announcementsUserId}
              />
            )}
            <UserProfile fullName={userDisplayName} showNavLinks={false} />
          </div>
        </div>
        <p className="text-sm text-zinc-500">
          Recipients → SMTP (Next) → Email Composer (send). With{" "}
          <code className="text-[0.7rem] text-zinc-500">REDIS_URL</code> in{" "}
          <code className="text-[0.7rem] text-zinc-500">.env.local</code>,{" "}
          <code className="text-[0.7rem] text-zinc-500">npm run dev</code> starts the worker; otherwise run{" "}
          <code className="text-[0.7rem] text-zinc-500">npm run worker</code> for queued sends.
        </p>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-6"
      >
        <div className="-mx-1 overflow-x-auto pb-1 md:mx-0">
          <TabsList
            variant="line"
            className="inline-flex w-max min-w-full gap-0 border-b border-zinc-800 bg-transparent p-0 md:w-full md:min-w-0 md:justify-between"
          >
            {TAB_VALUES.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="shrink-0 rounded-none border-b-2 border-transparent px-3 py-2.5 text-zinc-500 transition-colors after:hidden data-active:border-emerald-500 data-active:bg-transparent data-active:text-zinc-100 aria-selected:border-emerald-500 aria-selected:bg-transparent aria-selected:text-zinc-100 md:flex-1 md:px-4"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="wallet" className="mt-0 space-y-4 outline-none">
          <WalletPlanTab previewMode={previewMode} />
        </TabsContent>

        <TabsContent value="recipients" className="mt-0 outline-none">
          <CsvRecipientsTab onGoToSmtp={() => setActiveTab("smtp")} />
        </TabsContent>

        <TabsContent value="smtp" className="mt-0 outline-none">
          <SmtpForm
            previewMode={previewMode}
            onGoToComposer={() => setActiveTab("composer")}
          />
        </TabsContent>

        <TabsContent value="composer" className="mt-0 outline-none">
          {activeTab === "composer" ? (
            <EmailEditor
              previewMode={previewMode}
              isComposerActive={activeTab === "composer"}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="logs" className="mt-0 outline-none">
          <SendingLogsTab previewMode={previewMode} />
        </TabsContent>
      </Tabs>
    </div>
    </WalletStateProvider>
    </EmailCampaignProvider>
  );
}
