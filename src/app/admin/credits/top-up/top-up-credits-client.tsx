"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Loader2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
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
import { getWalletBalanceFor, topUpWallet } from "./actions";

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

function formatCredits(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : "0";
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
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [isApplying, startApplyTransition] = useTransition();

  // Re-sync local state when the server props change.
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

  const loadBalance = useCallback(async (uid: string) => {
    setBalanceLoading(true);
    const res = await getWalletBalanceFor(uid);
    setBalanceLoading(false);
    if (res.ok) {
      setBalance(res.data?.balance ?? 0);
    } else {
      setBalance(null);
      toast.error("Could not load balance.", { description: res.error });
    }
  }, []);

  function handleSelectUser(value: string | null) {
    setUserId(value);
    setBalance(null);
    if (value) void loadBalance(value);
  }

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = (u.full_name ?? "").toLowerCase();
      const email = u.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, search]);

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

  function validateAmount(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return "Enter an amount.";
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return "Amount must be a positive whole number.";
    }
    if (n > 10_000_000) return "Amount is unrealistically large.";
    return null;
  }

  function handleApply() {
    if (!userId) {
      toast.error("Select a user first.");
      return;
    }
    const err = validateAmount(amount);
    if (err) {
      setAmountError(err);
      return;
    }
    setAmountError(null);
    const numericAmount = Math.floor(Number(amount.trim()));

    startApplyTransition(async () => {
      const res = await topUpWallet({ userId, amount: numericAmount });
      if (!res.ok) {
        toast.error("Top-up failed.", { description: res.error });
        return;
      }
      const newBalance = res.data?.balance ?? null;
      setBalance(newBalance);
      setAmount("");
      toast.success(
        newBalance !== null
          ? `Added ${formatCredits(numericAmount)} credits. New balance: ${formatCredits(newBalance)}.`
          : `Added ${formatCredits(numericAmount)} credits.`,
      );
    });
  }

  return (
    <>
      <AdminPageHeader
        title="Top-up Credits"
        description="Add credits to a client wallet. Clients spend credits to activate server plans."
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
              No users match &ldquo;{search.trim()}&rdquo;. Clear the search to see all users.
            </div>
          ) : (
            <Select
              value={userId}
              onValueChange={handleSelectUser}
              disabled={selectDisabled || isApplying}
            >
              <SelectTrigger
                className={cn(
                  "h-auto min-h-9 w-full justify-between border-gray-700 bg-[#0F172A] py-2 text-left text-white",
                  "[&_[data-slot=select-value]]:line-clamp-2 [&_[data-slot=select-value]]:whitespace-normal",
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
              <SelectContent
                className="!w-max max-w-[min(36rem,calc(100vw-1.5rem))] !min-w-[min(26rem,calc(100vw-1.5rem))] border-gray-700 bg-[#111827]"
                alignItemWithTrigger={false}
                align="start"
              >
                {selectOptions.map((u) => (
                  <SelectItem
                    key={u.id}
                    value={u.id}
                    className="h-auto min-h-11 items-start py-2 [&>span:first-of-type]:min-w-0 [&>span:first-of-type]:w-full [&>span:first-of-type]:shrink [&>span:first-of-type]:whitespace-normal"
                  >
                    <span className="block text-sm leading-snug text-white">
                      {displayLabel(u)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {userId && (
          <div className="flex items-center gap-3 rounded-md border border-gray-800 bg-[#0F172A]/60 px-3 py-2.5 text-sm">
            <Wallet className="size-4 shrink-0 text-indigo-300" aria-hidden />
            <span className="text-gray-400">Current balance:</span>
            {balanceLoading ? (
              <span className="flex items-center gap-1.5 text-gray-500">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Loading…
              </span>
            ) : (
              <span className="font-semibold tabular-nums text-white">
                {balance === null ? "—" : `${formatCredits(balance)} credits`}
              </span>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="topup-amount" className="text-gray-300">
            Credit amount
          </Label>
          <Input
            id="topup-amount"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            className="border-gray-700 bg-[#0F172A] text-white"
            placeholder="e.g. 1000"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (amountError) setAmountError(null);
            }}
            disabled={isApplying || !userId}
            aria-invalid={Boolean(amountError) || undefined}
          />
          {amountError ? (
            <p className="text-xs text-red-400" role="alert">
              {amountError}
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Whole-number credits added to the wallet. The client spends these
              when activating a plan.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="border-gray-600"
            onClick={() => void refreshUsers()}
            disabled={refreshing || isApplying}
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
            onClick={handleApply}
            disabled={!userId || isApplying || refreshing || Boolean(fetchError) || empty}
          >
            {isApplying ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Applying…
              </>
            ) : (
              "Apply top-up"
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
