"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export type LogRow = {
  id: string;
  email: string;
  smtp: string;
  status: "Sent" | "Failed" | "Queued";
  error: string;
  at: string;
};

/** Page size for the delivery log table — keep small enough that the table fits on screen without an inner scrollbar. */
const PAGE_SIZE = 25;

const MOCK_LOGS: LogRow[] = [
  {
    id: "1",
    email: "ada@example.com",
    smtp: "smtp.gmail.com",
    status: "Sent",
    error: "—",
    at: "2026-04-18 10:02:11",
  },
  {
    id: "2",
    email: "grace@example.com",
    smtp: "smtp.mail.yahoo.com",
    status: "Failed",
    error: "Connection timeout (dummy)",
    at: "2026-04-18 10:02:14",
  },
  {
    id: "3",
    email: "alan@example.com",
    smtp: "smtp.office365.com",
    status: "Queued",
    error: "—",
    at: "2026-04-18 10:02:18",
  },
];

export function LogsTable({ rows = MOCK_LOGS }: { rows?: LogRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-zinc-800 hover:bg-transparent">
          <TableHead className="text-zinc-400">Email</TableHead>
          <TableHead className="text-zinc-400">SMTP Used</TableHead>
          <TableHead className="text-zinc-400">Status</TableHead>
          <TableHead className="text-zinc-400">Error Message</TableHead>
          <TableHead className="text-zinc-400">Timestamp</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="border-zinc-800">
            <TableCell className="font-mono text-sm text-zinc-200">{row.email}</TableCell>
            <TableCell className="text-zinc-400">{row.smtp}</TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={
                  row.status === "Sent"
                    ? "border-emerald-800 bg-emerald-950/40 text-emerald-300"
                    : row.status === "Failed"
                      ? "border-red-800 bg-red-950/40 text-red-300"
                      : "border-zinc-600 bg-zinc-900 text-zinc-400"
                }
              >
                {row.status}
              </Badge>
            </TableCell>
            <TableCell className="max-w-[200px] truncate text-zinc-500">{row.error}</TableCell>
            <TableCell className="tabular-nums text-zinc-500">{row.at}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function mapStatus(
  s: string,
): "Sent" | "Failed" | "Queued" {
  if (s === "sent") return "Sent";
  if (s === "failed" || s === "bounced") return "Failed";
  return "Queued";
}

export function SendingLogsTab({ previewMode = false }: { previewMode?: boolean }) {
  const [rows, setRows] = React.useState<LogRow[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [sentTotal, setSentTotal] = React.useState(0);
  const [failedTotal, setFailedTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const load = React.useCallback(
    async (targetPage: number) => {
      if (previewMode) {
        setRows(MOCK_LOGS);
        setTotalCount(MOCK_LOGS.length);
        setSentTotal(MOCK_LOGS.filter((r) => r.status === "Sent").length);
        setFailedTotal(MOCK_LOGS.filter((r) => r.status === "Failed").length);
        setLoading(false);
        return;
      }
      setLoading(true);
      const supabase = createClient();
      const from = (targetPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      // RLS scopes results to the signed-in user, so per-user counts are
      // returned automatically. Three head-only counts cost almost nothing
      // and keep the totals card honest across the whole log set.
      const [pageRes, sentRes, failedRes] = await Promise.all([
        supabase
          .from("sending_logs")
          .select("id, recipient_email, smtp_used, status, error_message, sent_at", {
            count: "exact",
          })
          .order("sent_at", { ascending: false })
          .range(from, to),
        supabase
          .from("sending_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", "sent"),
        supabase
          .from("sending_logs")
          .select("id", { count: "exact", head: true })
          .in("status", ["failed", "bounced"]),
      ]);
      if (pageRes.error) {
        console.error("[sending_logs]", pageRes.error);
        setRows([]);
        setTotalCount(0);
        setSentTotal(0);
        setFailedTotal(0);
        setLoading(false);
        return;
      }
      setRows(
        (pageRes.data ?? []).map((r) => ({
          id: r.id,
          email: r.recipient_email,
          smtp: r.smtp_used ?? "—",
          status: mapStatus(r.status),
          error: r.error_message?.trim() || "—",
          at: r.sent_at
            ? new Date(r.sent_at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "medium",
              })
            : "—",
        })),
      );
      setTotalCount(pageRes.count ?? 0);
      setSentTotal(sentRes.count ?? 0);
      setFailedTotal(failedRes.count ?? 0);
      setLoading(false);
    },
    [previewMode],
  );

  // Async log fetch — setState happens after `await`, not synchronously within
  // the effect body, so the cascading-render rule doesn't actually apply.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(page);
  }, [load, page, refreshKey]);

  // Clamp the active page if the underlying log set shrinks (e.g. cascade
  // delete after a campaign is removed). Adjusted during render to match the
  // pattern used elsewhere (see csv-table.tsx) instead of a chained effect.
  if (page > totalPages) {
    setPage(totalPages);
  }

  const pct = totalCount > 0 ? Math.round((sentTotal / totalCount) * 100) : 0;
  const showingFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(totalCount, (page - 1) * PAGE_SIZE + rows.length);

  function goToPage(target: number) {
    const next = Math.min(totalPages, Math.max(1, target));
    if (next !== page) setPage(next);
  }

  function handleRefresh() {
    setPage(1);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Progress</CardTitle>
          <CardDescription>
            Totals are calculated across all of your sending logs. Start a send from the Email
            Composer tab. With <code className="text-xs text-zinc-400">REDIS_URL</code> in{" "}
            <code className="text-xs text-zinc-400">.env.local</code>,{" "}
            <code className="text-xs text-zinc-400">npm run dev</code> starts the worker for you;
            otherwise run <code className="text-xs text-zinc-400">npm run worker</code> in another
            terminal. Then refresh.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress
            value={pct}
            className="w-full [&_[data-slot=progress-track]]:h-3 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-blue-500/90"
          />
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
              <dt className="text-xs text-zinc-500">Sent (total)</dt>
              <dd className="text-2xl font-semibold tabular-nums text-zinc-100">{sentTotal}</dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
              <dt className="text-xs text-zinc-500">Failed (total)</dt>
              <dd className="text-2xl font-semibold tabular-nums text-red-400">{failedTotal}</dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
              <dt className="text-xs text-zinc-500">Logs (total)</dt>
              <dd className="text-2xl font-semibold tabular-nums text-zinc-100">{totalCount}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-zinc-100">Delivery log</CardTitle>
            <CardDescription>
              {previewMode
                ? "Mock data — connect Supabase to see real deliveries."
                : totalCount === 0
                  ? "No deliveries logged yet."
                  : `Showing ${showingFrom}–${showingTo} of ${totalCount} ${
                      totalCount === 1 ? "row" : "rows"
                    }.`}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <span className="tabular-nums text-sm text-zinc-400">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-700"
                disabled={page <= 1 || loading || previewMode}
                onClick={() => goToPage(page - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-zinc-700"
                disabled={page >= totalPages || loading || previewMode}
                onClick={() => goToPage(page + 1)}
                aria-label="Next page"
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="inline-flex border-zinc-700"
              disabled={loading || previewMode}
              onClick={handleRefresh}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading && !previewMode ? (
            <p className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-700 py-8 text-center text-sm text-zinc-500">
              {previewMode
                ? "No mock rows."
                : "No delivery logs to show. Send a campaign from the Email Composer tab, then refresh."}
            </p>
          ) : (
            <LogsTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
