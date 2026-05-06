import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isClientDashboardPreviewMode } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/server";

export default async function ClientCampaignsPage() {
  type Row = {
    id: string;
    stream_name: string;
    status: string;
    total_emails: number;
    sent_count: number;
    failed_count: number;
    created_at: string;
  };
  let rows: Row[] = [];

  if (!isClientDashboardPreviewMode()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("campaigns")
      .select("id, stream_name, status, total_emails, sent_count, failed_count, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    rows = (data ?? []) as Row[];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground">
            Compose, queue with BullMQ, and track per-recipient logs.
          </p>
        </div>
        <Link
          href="/client/campaigns/new"
          className={cn(buttonVariants({ size: "default" }))}
        >
          New campaign
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All campaigns</CardTitle>
          <CardDescription>Merge tags, HTML/text bodies, custom headers, attachments</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.stream_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {r.sent_count}/{r.total_emails} sent · {r.failed_count} failed
                  </TableCell>
                </TableRow>
              ))}
              {!rows?.length && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No campaigns yet. Create one to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
