"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  clientId?: string;
  page?: number;
  fetchError?: string;
};

const ALL_CLIENTS = "__all__";
const ROWS_PER_PAGE = 15;

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
      return "border-gray-600 text-zinc-400";
  }
}

function clientOptionLabel(r: MonitorCampaignRow): string {
  if (r.client && r.clientEmail && r.client !== r.clientEmail) {
    return `${r.client} — ${r.clientEmail}`;
  }
  return r.client || r.clientEmail || "Unknown client";
}

export function MonitorClient({ rows, clientId = "", page = 1, fetchError }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, setRefreshing] = React.useState(false);
  const [selectedClientId, setSelectedClientId] = React.useState(
    clientId || ALL_CLIENTS,
  );

  React.useEffect(() => {
    setSelectedClientId(clientId || ALL_CLIENTS);
  }, [clientId]);

  const clientOptions = React.useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of rows) {
      if (!byId.has(r.userId)) byId.set(r.userId, clientOptionLabel(r));
    }
    return Array.from(byId.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [rows]);

  const clientLabelLookup = React.useMemo(() => {
    const m = new Map<string, string>();
    m.set(ALL_CLIENTS, "All clients");
    for (const c of clientOptions) m.set(c.id, c.label);
    return m;
  }, [clientOptions]);

  const filteredRows = React.useMemo(() => {
    if (!selectedClientId || selectedClientId === ALL_CLIENTS) return rows;
    return rows.filter((r) => r.userId === selectedClientId);
  }, [rows, selectedClientId]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const paginatedRows = React.useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    return filteredRows.slice(start, start + ROWS_PER_PAGE);
  }, [filteredRows, currentPage]);

  const hasLiveCampaigns = rows.some((r) => r.status === "sending" || r.status === "queued");

  function pushParams(next: { clientId?: string; page?: number }) {
    const sp = new URLSearchParams();
    const cid = next.clientId ?? selectedClientId;
    const p = next.page ?? currentPage;
    if (cid && cid !== ALL_CLIENTS) sp.set("client", cid);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function applyClientFilter(nextId: string | null) {
    const id = nextId ?? ALL_CLIENTS;
    setSelectedClientId(id);
    pushParams({ clientId: id, page: 1 });
  }

  function goToPage(p: number) {
    pushParams({ page: Math.min(Math.max(1, p), totalPages) });
  }

  const refresh = React.useCallback(() => {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 600);
  }, [router]);

  React.useEffect(() => {
    if (!hasLiveCampaigns) return;
    const id = window.setInterval(() => router.refresh(), 8_000);
    return () => window.clearInterval(id);
  }, [hasLiveCampaigns, router]);

  const totals = React.useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => {
          acc.sent += r.emailsSent;
          acc.failed += r.failedCount;
          return acc;
        },
        { sent: 0, failed: 0 },
      ),
    [filteredRows],
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
            className="border-gray-700 bg-transparent text-zinc-200 hover:bg-emerald-950/40"
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

      {hasLiveCampaigns ? (
        <p className="mb-3 text-xs text-gray-500">
          Auto-refreshing every 8s while campaigns are queued or sending.
        </p>
      ) : null}

      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full max-w-2xl space-y-1.5">
          <Label htmlFor="monitor-client-filter" className="text-sm text-zinc-400">
            Client
          </Label>
          <Select value={selectedClientId} onValueChange={applyClientFilter}>
            <SelectTrigger
              id="monitor-client-filter"
              className="h-10 w-full max-w-2xl border-zinc-700 bg-zinc-950/80 font-sans text-sm text-zinc-100"
            >
              <SelectValue placeholder="All clients">
                {(value: string | null) => {
                  if (!value || value === ALL_CLIENTS) return "All clients";
                  return clientLabelLookup.get(value) ?? "All clients";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="max-h-72 min-w-[32rem] max-w-2xl border-zinc-700 bg-zinc-950/80 font-sans text-sm text-zinc-100"
            >
              <SelectItem
                value={ALL_CLIENTS}
                className="font-sans text-sm text-zinc-100 hover:bg-emerald-950/40"
              >
                All clients
              </SelectItem>
              {clientOptions.map((c) => (
                <SelectItem
                  key={c.id}
                  value={c.id}
                  className="font-sans text-sm text-zinc-100 hover:bg-emerald-950/40"
                >
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm text-zinc-400">
        <span>
          Campaigns: <span className="tabular-nums text-zinc-200">{filteredRows.length}</span>
          {selectedClientId !== ALL_CLIENTS && rows.length !== filteredRows.length ? (
            <span className="text-gray-600"> / {rows.length} total</span>
          ) : null}
        </span>
        <span>
          Emails sent: <span className="tabular-nums text-zinc-200">{totals.sent.toLocaleString()}</span>
        </span>
        <span>
          Failed: <span className="tabular-nums text-zinc-200">{totals.failed.toLocaleString()}</span>
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">Campaign</TableHead>
              <TableHead className="text-zinc-400">Client</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              <TableHead className="text-right text-zinc-400">Sent</TableHead>
              <TableHead className="text-right text-zinc-400">Failed</TableHead>
              <TableHead className="text-right text-zinc-400">Total</TableHead>
              <TableHead className="text-zinc-400">Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedRows.length === 0 ? (
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableCell colSpan={7} className="py-10 text-center text-gray-500">
                  {rows.length === 0
                    ? "No campaigns yet. Client sends will appear here."
                    : "No campaigns for this client."}
                </TableCell>
              </TableRow>
            ) : (
              paginatedRows.map((c) => (
                <TableRow key={c.id} className="border-zinc-800">
                  <TableCell className="max-w-[200px] truncate font-medium text-zinc-50" title={c.name}>
                    {c.name}
                  </TableCell>
                  <TableCell className="max-w-[220px] text-zinc-400">
                    <div className="truncate font-sans text-sm" title={c.client}>
                      {c.client}
                    </div>
                    {c.clientEmail && c.client !== c.clientEmail ? (
                      <div className="truncate font-sans text-xs text-gray-600">{c.clientEmail}</div>
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
                  <TableCell className="text-right tabular-nums text-zinc-300">
                    {c.emailsSent.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-400">
                    {c.failedCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-500">
                    {c.totalEmails.toLocaleString()}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-sans text-sm text-gray-500">
                    {formatDate(c.date)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {filteredRows.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
          <span className="tabular-nums">
            Page {currentPage} of {totalPages}
            <span className="text-gray-600">
              {" "}
              · {ROWS_PER_PAGE} per page · {filteredRows.length} campaign
              {filteredRows.length === 1 ? "" : "s"}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-gray-700 text-zinc-200"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-gray-700 text-zinc-200"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
