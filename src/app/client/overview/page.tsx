import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

export default async function ClientOverviewPage() {
  let credits:
    | {
        email_credits: number;
        server_credits: number;
        time_credits_hours: number;
        campaign_credits: number;
      }
    | null
    | undefined;
  let campaignCount: number | null = 0;

  if (!isClientDashboardPreviewMode()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: creditRow } = await supabase
      .from("credits")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (creditRow && isExpired(creditRow.expires_at as string | null)) {
      credits = {
        email_credits: 0,
        server_credits: 0,
        time_credits_hours: 0,
        campaign_credits: 0,
      };
    } else {
      credits = creditRow ?? undefined;
    }

    const { count: count } = await supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    campaignCount = count;
  }

  return (
    <div className="space-y-8 p-4 text-zinc-100">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-zinc-500">
          Credit balances and campaign totals (proposal: email, server, time, campaign credits).
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Email credits</CardTitle>
            <CardDescription>Per successful send</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {credits?.email_credits ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Server credits</CardTitle>
            <CardDescription>Per SMTP in campaign</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {credits?.server_credits ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Time credits</CardTitle>
            <CardDescription>Hours of active sending</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {credits?.time_credits_hours ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Campaign credits</CardTitle>
            <CardDescription>Campaigns started</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {credits?.campaign_credits ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle>Your campaigns</CardTitle>
          <CardDescription>Total campaigns created: {campaignCount ?? 0}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500">
            Use <span className="font-medium text-zinc-300">Compose</span> for the main sending
            console (modules D–G).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
