"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
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
  listActiveClientUsers,
  type AdminClientUserRow,
} from "@/app/admin/users/actions";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type TopUpCreditsClientProps = {
  initialUsers: AdminClientUserRow[];
  fetchError?: string;
};

function sortByName(users: AdminClientUserRow[]): AdminClientUserRow[] {
  return [...users].sort((a, b) => {
    const labelA = (a.full_name?.trim() || a.email).toLowerCase();
    const labelB = (b.full_name?.trim() || b.email).toLowerCase();
    return labelA.localeCompare(labelB, undefined, { sensitivity: "base" });
  });
}

function displayLabel(u: AdminClientUserRow) {
  const name = u.full_name?.trim();
  return name ? `${name} — ${u.email}` : u.email;
}

export function TopUpCreditsClient({
  initialUsers,
  fetchError: initialFetchError,
}: TopUpCreditsClientProps) {
  const [users, setUsers] = useState<AdminClientUserRow[]>(() =>
    sortByName(initialUsers),
  );
  const [fetchError, setFetchError] = useState<string | undefined>(initialFetchError);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Re-sync local state when the server props change. See React docs:
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [lastInitialUsers, setLastInitialUsers] = useState(initialUsers);
  if (lastInitialUsers !== initialUsers) {
    setLastInitialUsers(initialUsers);
    setUsers(sortByName(initialUsers));
  }
  const [lastInitialFetchError, setLastInitialFetchError] = useState(initialFetchError);
  if (lastInitialFetchError !== initialFetchError) {
    setLastInitialFetchError(initialFetchError);
    setFetchError(initialFetchError);
  }

  const refreshUsers = useCallback(async () => {
    setRefreshing(true);
    setFetchError(undefined);
    const result = await listActiveClientUsers();
    setRefreshing(false);
    if (!result.ok) {
      setFetchError(result.error);
      return;
    }
    const next = sortByName(result.data ?? []);
    setUsers(next);
    setUserId((current) => {
      if (current && next.some((u) => u.id === current)) return current;
      return null;
    });
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUsers();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = (u.full_name ?? "").toLowerCase();
      const email = u.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, search]);

  /** Keep current selection visible even if search would hide it */
  const selectOptions = useMemo(() => {
    const selected = userId ? users.find((u) => u.id === userId) : null;
    if (selected && !filteredUsers.some((u) => u.id === selected.id)) {
      return [selected, ...filteredUsers];
    }
    return filteredUsers;
  }, [users, filteredUsers, userId]);

  const empty = users.length === 0 && !refreshing && !fetchError;
  const showSkeleton = refreshing && users.length === 0;
  const noSearchMatches =
    users.length > 0 && search.trim() !== "" && selectOptions.length === 0;
  const selectDisabled = refreshing || Boolean(fetchError);

  return (
    <>
      <AdminPageHeader
        title="Top-up Credits"
        description="Add credits to an existing client after offline payment."
      />
      <div className="max-w-lg space-y-6 rounded-lg border border-gray-800 bg-[#111827] p-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-gray-300">User</Label>
            {refreshing && (
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Loading users…
              </span>
            )}
          </div>

          {fetchError && (
            <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              Could not load users: {fetchError}
            </p>
          )}

          {empty && !fetchError && (
            <p className="text-sm text-amber-200/90" role="status">
              No users available. Add an active client under{" "}
              <span className="font-medium text-amber-100">User Management</span>, then refresh or
              reopen this page.
            </p>
          )}

          {users.length > 0 && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500"
                aria-hidden
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="border-gray-700 bg-[#0F172A] pl-9 text-white placeholder:text-gray-500"
                aria-label="Filter users"
              />
            </div>
          )}

          {showSkeleton ? (
            <Skeleton className="h-11 w-full bg-gray-700/80" aria-label="Loading users" />
          ) : empty ? (
            <div
              className="flex h-11 items-center rounded-md border border-dashed border-gray-600 bg-[#0F172A]/80 px-3 text-sm text-gray-500"
              role="status"
            >
              No users available
            </div>
          ) : noSearchMatches ? (
            <div
              className="rounded-md border border-gray-700 bg-[#0F172A]/80 px-3 py-2 text-sm text-gray-400"
              role="status"
            >
              No users match “{search.trim()}”. Clear the search to see all users.
            </div>
          ) : (
            <Select
              value={userId}
              onValueChange={(v) => setUserId(v)}
              disabled={selectDisabled}
            >
              <SelectTrigger
                className={cn(
                  "border-gray-700 bg-[#0F172A] text-white",
                  selectDisabled && "opacity-70",
                )}
                aria-busy={refreshing}
              >
                <SelectValue placeholder={refreshing ? "Loading users…" : "Select client"}>
                  {(value: string | null) => {
                    if (!value) return refreshing ? "Loading users…" : "Select client";
                    const u = users.find((x) => x.id === value);
                    return u ? displayLabel(u) : "Select client";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-gray-700 bg-[#111827]">
                {selectOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {displayLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-gray-300">Credit amount</Label>
          <Input
            type="number"
            min={0}
            className="border-gray-700 bg-[#0F172A] text-white"
            placeholder="e.g. 10000"
          />
          <p className="text-xs text-gray-500">
            Applies to the credit type selected in assignment workflow (Phase 2).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="border-gray-600"
            onClick={() => void refreshUsers()}
            disabled={refreshing}
          >
            {refreshing ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Refreshing…
              </>
            ) : (
              "Refresh users"
            )}
          </Button>
          <Button
            className="bg-indigo-600 hover:bg-indigo-500"
            onClick={() => console.log("Action triggered")}
            disabled={!userId || refreshing || Boolean(fetchError) || empty}
          >
            Apply top-up
          </Button>
        </div>
      </div>
    </>
  );
}
