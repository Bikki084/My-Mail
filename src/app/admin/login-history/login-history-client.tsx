"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type {
  LoginHistoryRow,
  LoginHistoryUser,
} from "./actions";

type Props = {
  rows: LoginHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  users: LoginHistoryUser[];
  filters: { userId: string; from: string; to: string };
  fetchError?: string;
};

const ALL_USERS = "__all__";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function LoginHistoryClient({
  rows,
  total,
  page,
  pageSize,
  users,
  filters,
  fetchError,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [userId, setUserId] = useState<string | null>(filters.userId || null);
  const [from, setFrom] = useState<string>(filters.from);
  const [to, setTo] = useState<string>(filters.to);

  useEffect(() => {
    setUserId(filters.userId || null);
    setFrom(filters.from);
    setTo(filters.to);
  }, [filters.userId, filters.from, filters.to]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(userId || from || to);
  const selectedUserValue = userId ?? ALL_USERS;

  const userLookup = useMemo(() => {
    const m = new Map<string, string>([[ALL_USERS, "All users"]]);
    for (const u of users) m.set(u.id, u.label);
    return m;
  }, [users]);

  function pushWithParams(params: Record<string, string | null>, nextPage?: number) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v);
    });
    if (nextPage && nextPage > 1) sp.set("page", String(nextPage));
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function applyFilters() {
    pushWithParams({ userId: userId ?? "", from, to }, 1);
  }

  function clearFilters() {
    setUserId(null);
    setFrom("");
    setTo("");
    startTransition(() => router.push(pathname));
  }

  function goToPage(p: number) {
    pushWithParams(
      { userId: userId ?? "", from, to },
      p,
    );
  }

  const busyClass = isPending ? "opacity-70 pointer-events-none" : "";

  return (
    <>
      <AdminPageHeader
        title="Login History"
        description="Audit trail of client login and logout events."
      />

      <div className="flex flex-col gap-4 rounded-lg border border-gray-800 bg-[#111827] p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="w-full max-w-lg space-y-1.5 sm:col-span-2">
            <Label htmlFor="login-history-user-filter" className="text-xs text-gray-400">
              User
            </Label>
            <Select
              value={selectedUserValue}
              onValueChange={(v) => setUserId(v === ALL_USERS ? null : v)}
              disabled={users.length === 0}
            >
              <SelectTrigger
                id="login-history-user-filter"
                className="h-10 w-full min-w-[min(100%,28rem)] border-gray-700 bg-[#0F172A] font-sans text-sm text-gray-100"
              >
                <SelectValue placeholder="All users">
                  {(value: string | null) => {
                    if (!value || value === ALL_USERS) return "All users";
                    return userLookup.get(value) ?? "All users";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                className="max-h-72 min-w-[var(--anchor-width)] max-w-lg border-gray-700 bg-[#111827] font-sans text-sm"
                align="start"
              >
                <SelectItem value={ALL_USERS} className="font-sans text-sm text-gray-100">
                  All users
                </SelectItem>
                {users.map((u) => (
                  <SelectItem
                    key={u.id}
                    value={u.id}
                    className="font-sans text-sm text-gray-100"
                  >
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-400">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border-gray-700 bg-[#0F172A] text-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-400">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border-gray-700 bg-[#0F172A] text-white"
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
            {total.toLocaleString()} record{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {fetchError && (
        <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          Could not load login history: {fetchError}
        </p>
      )}

      <div
        className={`overflow-hidden rounded-lg border border-gray-800 bg-[#111827] ${busyClass}`}
      >
        <Table>
          <TableHeader>
            <TableRow className="border-gray-800 hover:bg-transparent">
              <TableHead className="text-gray-400">User</TableHead>
              <TableHead className="text-gray-400">Login time</TableHead>
              <TableHead className="text-gray-400">Logout time</TableHead>
              <TableHead className="text-gray-400">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!fetchError && rows.length === 0 && (
              <TableRow className="border-gray-800">
                <TableCell colSpan={4} className="text-center text-gray-500">
                  No login history available
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id} className="border-gray-800">
                <TableCell className="font-sans text-sm font-medium text-white">
                  {row.userLabel}
                </TableCell>
                <TableCell className="text-gray-400 tabular-nums">
                  {formatDateTime(row.loginAt)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.logoutAt ? (
                    <span className="text-gray-400">{formatDateTime(row.logoutAt)}</span>
                  ) : (
                    <span className="rounded-full border border-emerald-800 px-2 py-0.5 text-xs text-emerald-400">
                      Active session
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-sm text-gray-500">
                  {row.ipAddress || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 px-1 text-xs text-gray-400">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-gray-700"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1 || isPending}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-gray-700"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages || isPending}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
