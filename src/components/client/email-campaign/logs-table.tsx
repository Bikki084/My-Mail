"use client";

import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const load = React.useCallback(async () => {
    if (previewMode) {
      setRows(MOCK_LOGS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("sending_logs")
      .select("id, recipient_email, smtp_used, status, error_message, sent_at")
      .order("sent_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[sending_logs]", error);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(
      (data ?? []).map((r) => ({
        id: r.id,
        email: r.recipient_email,
        smtp: r.smtp_used ?? "—",
        status: mapStatus(r.status),
        error: r.error_message?.trim() || "—",
        at: r.sent_at
          ? new Date(r.sent_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" })
          : "—",
      })),
    );
    setLoading(false);
  }, [previewMode]);

  // Async log fetch — setState happens after `await`, not synchronously within
  // the effect body, so the cascading-render rule doesn't actually apply.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  const sent = React.useMemo(
    () => rows.filter((r) => r.status === "Sent").length,
    [rows],
  );
  const failed = React.useMemo(
    () => rows.filter((r) => r.status === "Failed").length,
    [rows],
  );
  const total = rows.length;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader>
          <CardTitle className="text-zinc-100">Progress (recent logs)</CardTitle>
          <CardDescription>
            Totals are derived from the last 100 log rows. Start a send from the Email Composer tab, run{" "}
            <code className="text-xs text-zinc-400">npm run worker</code>, then refresh.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress
            value={pct}
            className="w-full [&_[data-slot=progress-track]]:h-3 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-blue-500/90"
          />
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
              <dt className="text-xs text-zinc-500">Sent (in view)</dt>
              <dd className="text-2xl font-semibold tabular-nums text-zinc-100">{sent}</dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
              <dt className="text-xs text-zinc-500">Failed (in view)</dt>
              <dd className="text-2xl font-semibold tabular-nums text-red-400">{failed}</dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
              <dt className="text-xs text-zinc-500">Rows shown</dt>
              <dd className="text-2xl font-semibold tabular-nums text-zinc-100">{total}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/40 ring-zinc-800">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-zinc-100">Delivery log</CardTitle>
            <CardDescription>
              {previewMode
                ? "Mock data — connect Supabase to see real deliveries."
                : "Latest deliveries for your account."}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="inline-flex border-zinc-700"
            disabled={loading || previewMode}
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading && !previewMode ? (
            <p className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              Loading…
            </p>
          ) : (
            <LogsTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
