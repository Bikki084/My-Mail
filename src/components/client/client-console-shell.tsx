"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail } from "lucide-react";
import { UserProfile } from "@/components/client/email-campaign/user-profile";
import { LoginEventBootstrap } from "@/components/auth/login-event-bootstrap";
import { AnnouncementBell } from "@/components/client/announcements/announcement-bell";
import {
  AnnouncementsProvider,
  useAnnouncementsSnapshot,
} from "@/components/client/announcements/announcements-context";
import type { AnnouncementItem } from "@/app/actions/announcements";
import { APP_BRAND_NAME } from "@/lib/brand";

function HeaderBell() {
  const { all, unread, userId } = useAnnouncementsSnapshot();
  return (
    <AnnouncementBell
      initialAll={all}
      initialUnread={unread}
      userId={userId}
    />
  );
}

function ClientSubpageHeader({
  workspaceUserName,
  previewMode,
}: {
  workspaceUserName: string;
  previewMode: boolean;
}) {
  const pathname = usePathname();
  if (pathname === "/client") return null;

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800/90 bg-zinc-950 px-4 py-3 md:px-6">
      <Link
        href="/client"
        className="group flex items-center gap-2.5 text-white outline-none ring-zinc-600 focus-visible:rounded-lg focus-visible:ring-2"
        aria-label={`${APP_BRAND_NAME} — back to Email Campaign`}
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-md shadow-violet-950/35 ring-1 ring-white/10 transition group-hover:brightness-110">
          <Mail className="size-4 text-white" strokeWidth={2} />
        </span>
        <span className="text-sm font-semibold tracking-tight">{APP_BRAND_NAME}</span>
      </Link>
      <div className="flex items-center gap-1">
        {!previewMode && <HeaderBell />}
        <UserProfile fullName={workspaceUserName} />
      </div>
    </header>
  );
}

export function ClientConsoleShell({
  previewMode = false,
  workspaceUserName = "Client",
  userId = null,
  initialAnnouncementsAll = [],
  initialAnnouncementsUnread = [],
  children,
}: {
  /** Set by server layout when Supabase is not configured — UI-only preview in development. */
  previewMode?: boolean;
  /** Shown in the account menu and on sub-routes (not on `/client`, where the main console header applies). */
  workspaceUserName?: string;
  /** Supabase user id, used to scope per-user client-side storage (e.g. auto-popup flag). */
  userId?: string | null;
  initialAnnouncementsAll?: AnnouncementItem[];
  initialAnnouncementsUnread?: AnnouncementItem[];
  children: React.ReactNode;
}) {
  return (
    <AnnouncementsProvider
      value={{
        all: initialAnnouncementsAll,
        unread: initialAnnouncementsUnread,
        userId,
      }}
    >
      <div className="flex min-h-svh flex-col bg-zinc-950">
        {!previewMode && <LoginEventBootstrap />}
        {previewMode && (
          <div className="border-b border-amber-500/35 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-100/95">
            Client dashboard preview — add{" "}
            <code className="rounded bg-black/30 px-1 font-mono text-[0.8rem]">
              NEXT_PUBLIC_SUPABASE_URL
            </code>{" "}
            and{" "}
            <code className="rounded bg-black/30 px-1 font-mono text-[0.8rem]">
              NEXT_PUBLIC_SUPABASE_ANON_KEY
            </code>{" "}
            to <code className="font-mono">.env.local</code> for real sign-in.
          </div>
        )}
        <ClientSubpageHeader
          workspaceUserName={workspaceUserName}
          previewMode={previewMode}
        />
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </AnnouncementsProvider>
  );
}
