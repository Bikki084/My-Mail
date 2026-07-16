import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { BrevoQuotaPanel } from "@/components/admin/brevo-quota-panel";
import { UserEmailsTodayCards } from "@/components/admin/user-emails-today-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBrevoQuotaForAdmin } from "@/app/admin/brevo-quota-actions";
import { resolveCacheLocale } from "@/lib/cache/render-cache";
import {
  getCachedAdminDashboardStats,
  getCachedPerUserEmailsToday,
} from "@/lib/cache/shared-queries";

/** Tenant-wide stats fragment; invalidated via `admin-stats` tag on writes. */
export const revalidate = 45;

export default async function AdminDashboardPage() {
  const locale = await resolveCacheLocale();
  const [s, brevo, perUser] = await Promise.all([
    getCachedAdminDashboardStats(locale),
    getBrevoQuotaForAdmin(),
    getCachedPerUserEmailsToday(locale),
  ]);
  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Overview of tenants, sending activity, credits, and Brevo relay quota."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-gray-800 bg-[#111827]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Client accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums text-white">
              {s.clientAccounts.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-[#111827]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Active campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums text-white">
              {s.activeCampaigns.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-[#111827]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Emails sent (today)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums text-white">
              {s.emailsSentToday.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-[#111827]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Credits issued (month)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums text-white">
              {s.creditsIssuedMonth.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <BrevoQuotaPanel initial={brevo} />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-gray-400">Emails sent today by client</h2>
        <UserEmailsTodayCards rows={perUser.rows} live={perUser.live} />
      </div>
    </>
  );
}
