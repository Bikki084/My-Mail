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
  rowNum: number;
  email: string;
  smtp: string;
  status: "Sent" | "Failed" | "Queued";
  error: string;
  at: string;
};

/** Page size for the delivery log table — keep small enough that the table fits on screen without an inner scrollbar. */
const PAGE_SIZE = 25;

type StatsScope = "all" | "batch";

type BatchInfo = {
  id: string;
  sent: number;
  failed: number;
  total: number;
  streamName: string;
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const MOCK_LOGS: LogRow[] = [
  {
    id: "1",
    rowNum: 1,
    email: "ada@example.com",
    smtp: "smtp.gmail.com",
    status: "Sent",
    error: "—",
    at: "2026-04-18 10:02:11",
  },
  {
    id: "2",
    rowNum: 2,
    email: "grace@example.com",
    smtp: "smtp.mail.yahoo.com",
    status: "Failed",
    error: "Connection timeout (dummy)",
    at: "2026-04-18 10:02:14",
  },
  {
    id: "3",
    rowNum: 3,
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
          <TableHead className="text-zinc-400">#</TableHead>
          <TableHead className="text-zinc-400">Email</TableHead>
          <TableHead className="text-zinc-400">SMTP account</TableHead>
          <TableHead className="text-zinc-400">Status</TableHead>
          <TableHead className="text-zinc-400">Error Message</TableHead>
          <TableHead className="text-zinc-400">Timestamp</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="border-zinc-800">
            <TableCell className="tabular-nums text-zinc-500">{row.rowNum}</TableCell>
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
  const [allTimeLogCount, setAllTimeLogCount] = React.useState(0);
  const [sentTotal, setSentTotal] = React.useState(0);
  const [failedTotal, setFailedTotal] = React.useState(0);
  const [statsScope, setStatsScope] = React.useState<StatsScope>("all");
  const [batchInfo, setBatchInfo] = React.useState<BatchInfo | null>(null);
  const [batchResolved, setBatchResolved] = React.useState(previewMode);
  const [page, setPage] = React.useState(1);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchBatchInfo = React.useCallback(async (): Promise<BatchInfo | null> => {
    if (previewMode) {
      return {
        id: "preview-batch",
        sent: MOCK_LOGS.filter((r) => r.status === "Sent").length,
        failed: MOCK_LOGS.filter((r) => r.status === "Failed").length,
        total: MOCK_LOGS.length,
        streamName: "Preview batch",
      };
    }

    try {
      const res = await fetch("/api/campaigns/active", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const j = (await res.json()) as {
          campaign?: {
            id: string;
            totalEmails: number;
            sentSoFar: number;
            failedSoFar: number;
            sentCount: number;
            failedCount: number;
            streamName: string;
          };
        };
        if (j.campaign) {
          const c = j.campaign;
          return {
            id: c.id,
            sent: c.sentSoFar ?? c.sentCount ?? 0,
            failed: c.failedSoFar ?? c.failedCount ?? 0,
            total: c.totalEmails ?? 0,
            streamName: c.streamName?.trim() || "Current batch",
          };
        }
      }
    } catch {
      /* fall through to today's latest campaign */
    }

    const supabase = createClient();
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, total_emails, sent_count, failed_count, stream_name")
      .gte("created_at", startOfTodayIso())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!campaign) return null;

    const [sentRes, failedRes] = await Promise.all([
      supabase
        .from("sending_logs")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "sent"),
      supabase
        .from("sending_logs")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .in("status", ["failed", "bounced"]),
    ]);

    return {
      id: campaign.id,
      sent: sentRes.count ?? campaign.sent_count ?? 0,
      failed: failedRes.count ?? campaign.failed_count ?? 0,
      total: campaign.total_emails ?? 0,
      streamName: campaign.stream_name?.trim() || "Today's batch",
    };
  }, [previewMode]);

  const load = React.useCallback(
    async (targetPage: number, options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      const batchMode = statsScope === "batch";
      const batchCampaignId = batchInfo?.id ?? null;

      if (previewMode) {
        setRows(
          MOCK_LOGS.map((r, i) => ({
            ...r,
            rowNum: i + 1,
          })),
        );
        setTotalCount(MOCK_LOGS.length);
        setAllTimeLogCount(MOCK_LOGS.length);
        setSentTotal(MOCK_LOGS.filter((r) => r.status === "Sent").length);
        setFailedTotal(MOCK_LOGS.filter((r) => r.status === "Failed").length);
        setInitialLoading(false);
        return;
      }

      if (batchMode && !batchCampaignId) {
        setRows([]);
        setTotalCount(0);
        setInitialLoading(false);
        return;
      }

      if (!silent) {
        setInitialLoading(true);
      }
      const supabase = createClient();
      const from = (targetPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let pageQuery = supabase
        .from("sending_logs")
        .select("id, recipient_email, smtp_used, status, error_message, sent_at", {
          count: "exact",
        })
        .order("sent_at", { ascending: true, nullsFirst: false });

      if (batchMode && batchCampaignId) {
        pageQuery = pageQuery.eq("campaign_id", batchCampaignId);
      }

      const [pageRes, sentRes, failedRes, allTimeTotalRes] = await Promise.all([
        pageQuery.range(from, to),
        batchMode && batchCampaignId
          ? supabase
              .from("sending_logs")
              .select("id", { count: "exact", head: true })
              .eq("campaign_id", batchCampaignId)
              .eq("status", "sent")
          : supabase
              .from("sending_logs")
              .select("id", { count: "exact", head: true })
              .eq("status", "sent"),
        batchMode && batchCampaignId
          ? supabase
              .from("sending_logs")
              .select("id", { count: "exact", head: true })
              .eq("campaign_id", batchCampaignId)
              .in("status", ["failed", "bounced"])
          : supabase
              .from("sending_logs")
              .select("id", { count: "exact", head: true })
              .in("status", ["failed", "bounced"]),
        supabase
          .from("sending_logs")
          .select("id", { count: "exact", head: true }),
      ]);

      if (pageRes.error) {
        console.error("[sending_logs]", pageRes.error);
        if (!silent) {
          setRows([]);
          setTotalCount(0);
        }
        if (!batchMode) {
          setSentTotal(0);
          setFailedTotal(0);
        }
        setInitialLoading(false);
        return;
      }

      const total = pageRes.count ?? 0;
      setRows(
        (pageRes.data ?? []).map((r, idx) => ({
          id: r.id,
          rowNum: from + idx + 1,
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
      setTotalCount(total);
      setAllTimeLogCount(allTimeTotalRes.count ?? 0);
      if (batchMode) {
        setBatchInfo((prev) =>
          prev
            ? {
                ...prev,
                sent: sentRes.count ?? prev.sent,
                failed: failedRes.count ?? prev.failed,
                total: Math.max(prev.total, total),
              }
            : prev,
        );
      } else {
        setSentTotal(sentRes.count ?? 0);
        setFailedTotal(failedRes.count ?? 0);
      }
      setInitialLoading(false);
    },
    [previewMode, statsScope, batchInfo?.id],
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await fetchBatchInfo();
      if (!cancelled) {
        setBatchInfo(info);
        setBatchResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBatchInfo, refreshKey]);

  React.useEffect(() => {
    if (statsScope === "batch" && !batchResolved) return;
    void load(page);
  }, [load, page, refreshKey, statsScope, batchResolved, batchInfo?.id]);

  // Update progress totals only — no table reload, no flicker.
  React.useEffect(() => {
    if (previewMode) return;
    const timer = setInterval(() => {
      void (async () => {
        const supabase = createClient();
        const [sentRes, failedRes, totalRes, info] = await Promise.all([
          supabase
            .from("sending_logs")
            .select("id", { count: "exact", head: true })
            .eq("status", "sent"),
          supabase
            .from("sending_logs")
            .select("id", { count: "exact", head: true })
            .in("status", ["failed", "bounced"]),
          supabase
            .from("sending_logs")
            .select("id", { count: "exact", head: true }),
          fetchBatchInfo(),
        ]);
        setSentTotal(sentRes.count ?? 0);
        setFailedTotal(failedRes.count ?? 0);
        setAllTimeLogCount(totalRes.count ?? 0);
        if (statsScope === "all") {
          setTotalCount(totalRes.count ?? 0);
        }
        setBatchInfo(info);
      })();
    }, 5_000);
    return () => clearInterval(timer);
  }, [previewMode, statsScope, fetchBatchInfo]);

  if (page > totalPages) {
    setPage(totalPages);
  }

  const batchMode = statsScope === "batch";
  const batchSent = batchInfo?.sent ?? 0;
  const batchFailed = batchInfo?.failed ?? 0;
  const batchTotal = Math.max(
    batchInfo?.total ?? 0,
    batchMode ? totalCount : 0,
    batchSent + batchFailed,
  );
  const allTimeLogs = allTimeLogCount || sentTotal + failedTotal;
  const allTimePct =
    allTimeLogs > 0 ? Math.round((sentTotal / allTimeLogs) * 100) : 0;
  const batchPct =
    batchTotal > 0 ? Math.round((batchSent / batchTotal) * 100) : 0;
  const showingFrom = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(totalCount, (page - 1) * PAGE_SIZE + rows.length);

  function goToPage(target: number) {
    const next = Math.min(totalPages, Math.max(1, target));
    if (next !== page) setPage(next);
  }

  function handleRefreshSamePage() {
    setRefreshKey((k) => k + 1);
  }

  function handleGoToLatest() {
    const last = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    if (last !== page) setPage(last);
    else setRefreshKey((k) => k + 1);
  }

  function handleScopeChange(next: StatsScope) {
    if (next === statsScope) return;
    setStatsScope(next);
    setPage(1);
  }

  const tableLoading = initialLoading && rows.length === 0;

  return (
    <div className="space-y-6">
      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Progress</CardTitle>
          <CardDescription>
            All-time totals stay cumulative. Batch totals reset for each new bulk send today.
            Use Refresh on the log table to load new rows — your page and scroll position stay put.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              All time
            </p>
            <Progress
              value={allTimePct}
              className="w-full [&_[data-slot=progress-track]]:h-3 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-blue-500/90"
            />
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
                <dt className="text-xs text-zinc-500">Sent (total)</dt>
                <dd className="text-2xl font-semibold tabular-nums text-zinc-100">
                  {sentTotal}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
                <dt className="text-xs text-zinc-500">Failed (total)</dt>
                <dd className="text-2xl font-semibold tabular-nums text-red-400">
                  {failedTotal}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
                <dt className="text-xs text-zinc-500">Logs (total)</dt>
                <dd className="text-2xl font-semibold tabular-nums text-zinc-100">
                  {allTimeLogs}
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3 rounded-xl border border-emerald-900/50 bg-emerald-950/10 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-400/90">
                  This batch (today)
                </p>
                <p className="text-sm text-zinc-400">
                  {batchInfo
                    ? batchInfo.streamName
                    : "No batch started today — send from Email Composer."}
                </p>
              </div>
              <div
                className="flex shrink-0 rounded-lg border border-zinc-700 p-0.5"
                role="group"
                aria-label="Delivery log view"
              >
                <Button
                  type="button"
                  variant={statsScope === "all" ? "secondary" : "ghost"}
                  size="sm"
                  className={
                    statsScope === "all"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }
                  onClick={() => handleScopeChange("all")}
                >
                  All-time log
                </Button>
                <Button
                  type="button"
                  variant={statsScope === "batch" ? "secondary" : "ghost"}
                  size="sm"
                  className={
                    statsScope === "batch"
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:text-zinc-200"
                  }
                  onClick={() => handleScopeChange("batch")}
                >
                  Batch log (# from 1)
                </Button>
              </div>
            </div>
            <Progress
              value={batchPct}
              className="w-full [&_[data-slot=progress-track]]:h-3 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-emerald-500/90"
            />
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-emerald-900/40 bg-zinc-950/50 px-4 py-3">
                <dt className="text-xs text-zinc-500">Sent (batch)</dt>
                <dd className="text-2xl font-semibold tabular-nums text-zinc-100">
                  {batchSent}
                </dd>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-zinc-950/50 px-4 py-3">
                <dt className="text-xs text-zinc-500">Failed (batch)</dt>
                <dd className="text-2xl font-semibold tabular-nums text-red-400">
                  {batchFailed}
                </dd>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-zinc-950/50 px-4 py-3">
                <dt className="text-xs text-zinc-500">Total (batch)</dt>
                <dd className="text-2xl font-semibold tabular-nums text-zinc-100">
                  {batchTotal}
                </dd>
              </div>
            </dl>
          </section>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-zinc-100">Delivery log</CardTitle>
            <CardDescription>
              {previewMode
                ? "Mock data — connect Supabase to see real deliveries."
                : batchMode && !batchInfo
                  ? "No batch started today — switch to All time to see every delivery."
                  : totalCount === 0
                    ? batchMode
                      ? "No rows for this batch yet."
                      : "No deliveries logged yet."
                    : batchMode
                      ? `Rows ${showingFrom}–${showingTo} of ${totalCount} (this batch, # starts at 1).`
                      : `Rows ${showingFrom}–${showingTo} of ${totalCount} (all time, oldest first).`}
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
                disabled={page <= 1 || tableLoading || previewMode}
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
                disabled={page >= totalPages || tableLoading || previewMode}
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
              className="border-zinc-700"
              disabled={tableLoading || previewMode || totalCount === 0}
              onClick={handleGoToLatest}
            >
              Latest
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="inline-flex border-zinc-700"
              disabled={tableLoading || previewMode}
              onClick={handleRefreshSamePage}
            >
              {tableLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {tableLoading ? (
            <p className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-700 py-8 text-center text-sm text-zinc-500">
              {previewMode
                ? "No mock rows."
                : batchMode && !batchInfo
                  ? "No batch today. Send from Email Composer, or switch to All time."
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
