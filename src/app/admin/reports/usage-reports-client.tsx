"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UsageReportRow } from "./actions";

type Props = {
  rows: UsageReportRow[];
  filters: { from: string; to: string };
  fetchError?: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function UsageReportsClient({ rows, filters, fetchError }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.emails += r.emailsSent;
        acc.credits += r.creditsUsed;
        return acc;
      },
      { emails: 0, credits: 0 },
    );
  }, [rows]);

  const hasFilters = Boolean(from || to);

  function applyFilters() {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    const qs = sp.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function clearFilters() {
    setFrom("");
    setTo("");
    startTransition(() => router.push(pathname));
  }

  function exportCsv() {
    const header = ["User name", "Email", "Emails sent", "Credits used", "Last activity"];
    const lines = [header.map(csvCell).join(",")];
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.userName || ""),
          csvCell(r.userEmail),
          csvCell(r.emailsSent),
          csvCell(r.creditsUsed),
          csvCell(r.lastActivityAt ?? ""),
        ].join(","),
      );
    }
    const csv = lines.join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `usage-report-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const busyClass = isPending ? "opacity-70 pointer-events-none" : "";

  return (
    <>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <AdminPageHeader
          title="Usage Reports"
          description="Aggregated emails sent and credits consumed per client."
        />
        <Button
          variant="outline"
          className="shrink-0 border-zinc-700 bg-zinc-950/80 text-zinc-200 hover:bg-emerald-950/40"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          <Download className="mr-2 size-4" />
          Export CSV
        </Button>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-emerald-900/35 bg-zinc-900/75 p-4 backdrop-blur-sm">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border-gray-700 bg-[#0F172A] text-zinc-50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border-gray-700 bg-[#0F172A] text-zinc-50"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            className="bg-indigo-600 hover:bg-indigo-500"
            onClick={applyFilters}
            disabled={isPending}
          >
            Apply filters
          </Button>
          {hasFilters && (
            <Button
              variant="outline"
              className="border-gray-700"
              onClick={clearFilters}
              disabled={isPending}
            >
              Clear
            </Button>
          )}
          <span className="ml-auto text-xs text-gray-500">
            {rows.length.toLocaleString()} client{rows.length === 1 ? "" : "s"} ·{" "}
            {totals.emails.toLocaleString()} emails ·{" "}
            {totals.credits.toLocaleString()} credits
          </span>
        </div>
      </div>

      {fetchError && (
        <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          Could not load usage reports: {fetchError}
        </p>
      )}

      <div className={`overflow-hidden rounded-lg border border-emerald-900/35 bg-zinc-900/75 backdrop-blur-sm ${busyClass}`}>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">User</TableHead>
              <TableHead className="text-right text-zinc-400">Emails sent</TableHead>
              <TableHead className="text-right text-zinc-400">Credits used</TableHead>
              <TableHead className="text-zinc-400">Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!fetchError && rows.length === 0 && (
              <TableRow className="border-zinc-800">
                <TableCell colSpan={4} className="text-center text-gray-500">
                  No usage data available for the selected range
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.userId} className="border-zinc-800">
                <TableCell className="font-medium text-zinc-50">
                  <div className="flex flex-col">
                    <span>{row.userName || row.userEmail}</span>
                    {row.userName && (
                      <span className="text-xs text-gray-500">{row.userEmail}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-300">
                  {row.emailsSent.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums text-zinc-400">
                  {row.creditsUsed.toLocaleString()}
                </TableCell>
                <TableCell className="text-gray-500">
                  {formatDate(row.lastActivityAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
