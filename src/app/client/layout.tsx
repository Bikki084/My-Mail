import { redirect } from "next/navigation";
import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";
import { ClientConsoleShell } from "@/components/client/client-console-shell";
import type { AnnouncementItem } from "@/app/actions/announcements";
import { resolveCacheLocale } from "@/lib/cache/render-cache";
import { getCachedGlobalAnnouncements } from "@/lib/cache/shared-queries";

const UNDEFINED_TABLE_CODE = "42P01";
const POSTGREST_SCHEMA_CACHE_CODE = "PGRST205";

function isMissingReadsTable(err: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!err) return false;
  if (err.code === UNDEFINED_TABLE_CODE) return true;
  if (err.code === POSTGREST_SCHEMA_CACHE_CODE) return true;
  const msg = err.message?.toLowerCase() ?? "";
  if (!msg.includes("announcement_reads")) return false;
  return msg.includes("does not exist") || msg.includes("could not find");
}

async function loadAnnouncements(
  userId: string,
): Promise<{ all: AnnouncementItem[]; unread: AnnouncementItem[] }> {
  const locale = await resolveCacheLocale();
  const all = await getCachedGlobalAnnouncements(locale);
  if (all.length === 0) return { all: [], unread: [] };

  const supabase = await createClient();
  const { data: reads, error: rErr } = await supabase
    .from("announcement_reads")
    .select("announcement_id")
    .eq("user_id", userId);

  if (rErr) {
    if (!isMissingReadsTable(rErr)) {
      console.error("[announcements] reads fetch failed:", rErr.message);
    }
    // Either the reads table is missing (migration not applied) or the query
    // failed for some other reason — either way, treat everything as unread.
    return { all, unread: all };
  }

  const readSet = new Set((reads ?? []).map((r) => r.announcement_id as string));
  const unread = all.filter((a) => !readSet.has(a.id));
  return { all, unread };
}

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isClientDashboardPreviewMode()) {
    return (
      <div className="min-h-svh">
        <ClientConsoleShell previewMode workspaceUserName="Preview (no Supabase)">
          {children}
        </ClientConsoleShell>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/client");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "client") {
    redirect("/admin");
  }

  const workspaceUserName =
    profile.full_name?.trim() || profile.email || user.email || "Client";

  const { all, unread } = await loadAnnouncements(user.id);

  return (
    <div className="min-h-svh">
      <ClientConsoleShell
        workspaceUserName={workspaceUserName}
        userId={user.id}
        initialAnnouncementsAll={all}
        initialAnnouncementsUnread={unread}
      >
        {children}
      </ClientConsoleShell>
    </div>
  );
}
