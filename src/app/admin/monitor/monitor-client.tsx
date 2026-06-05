"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MonitorCampaignRow } from "./actions";

type Props = {
  rows: MonitorCampaignRow[];
  fetchError?: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-800 text-emerald-400";
    case "sending":
      return "border-blue-800 text-blue-400";
    case "queued":
      return "border-amber-800 text-amber-400";
    case "paused":
      return "border-orange-800 text-orange-400";
    case "failed":
    case "cancelled":
      return "border-red-800 text-red-400";
    case "draft":
      return "border-gray-600 text-gray-500";
    default:
      return "border-gray-600 text-gray-400";
  }
}

export function MonitorClient({ rows, fetchError }: Props) {
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  const hasLive = rows.some((r) => r.status === "sending" || r.status === "queued");

  const refresh = React.useCallback(() => {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 600);
  }, [router]);

  React.useEffect(() => {
    if (!hasLive) return;
    const id = window.setInterval(() => router.refresh(), 8_000);
    return () => window.clearInterval(id);
  }, [hasLive, router]);

  const totals = React.useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.sent += r.emailsSent;
          acc.failed += r.failedCount;
          return acc;
        },
        { sent: 0, failed: 0 },
      ),
    [rows],
  );

  return (
    <>
      <AdminPageHeader
        title="Sending Monitor"
        description="Live and historical email campaigns across all clients."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-gray-700 bg-transparent text-gray-200 hover:bg-gray-800"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 size-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {fetchError ? (
        <p className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {fetchError}
        </p>
      ) : null}

      {hasLive ? (
        <p className="mb-3 text-xs text-gray-500">
          Auto-refreshing every 8s while campaigns are queued or sending.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-4 text-sm text-gray-400">
        <span>
          Campaigns: <span className="tabular-nums text-gray-200">{rows.length}</span>
        </span>
        <span>
          Emails sent: <span className="tabular-nums text-gray-200">{totals.sent.toLocaleString()}</span>
        </span>
        <span>
          Failed: <span className="tabular-nums text-gray-200">{totals.failed.toLocaleString()}</span>
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-[#111827]">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-800 hover:bg-transparent">
              <TableHead className="text-gray-400">Campaign</TableHead>
              <TableHead className="text-gray-400">Client</TableHead>
              <TableHead className="text-gray-400">Status</TableHead>
              <TableHead className="text-right text-gray-400">Sent</TableHead>
              <TableHead className="text-right text-gray-400">Failed</TableHead>
              <TableHead className="text-right text-gray-400">Total</TableHead>
              <TableHead className="text-gray-400">Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="border-gray-800 hover:bg-transparent">
                <TableCell colSpan={7} className="py-10 text-center text-gray-500">
                  No campaigns yet. Client sends will appear here.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id} className="border-gray-800">
                  <TableCell className="max-w-[200px] truncate font-medium text-white" title={c.name}>
                    {c.name}
                  </TableCell>
                  <TableCell className="max-w-[180px] text-gray-400">
                    <div className="truncate" title={c.clientEmail}>
                      {c.client}
                    </div>
                    {c.clientEmail && c.client !== c.clientEmail ? (
                      <div className="truncate text-xs text-gray-600">{c.clientEmail}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(c.status)}>
                      {c.status}
                    </Badge>
                    {c.lastError && (c.status === "failed" || c.status === "paused" || c.status === "cancelled") ? (
                      <p className="mt-1 max-w-[220px] truncate text-xs text-red-400/90" title={c.lastError}>
                        {c.lastError}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-300">
                    {c.emailsSent.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-400">
                    {c.failedCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-500">
                    {c.totalEmails.toLocaleString()}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-gray-500">{formatDate(c.date)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
