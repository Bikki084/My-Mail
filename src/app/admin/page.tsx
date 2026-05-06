import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardStats } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const s = await getDashboardStats();
  return (
    <>
      <AdminPageHeader
        title="Dashboard"
        description="Overview of tenants, sending activity, and credits."
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
    </>
  );
}
