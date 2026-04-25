"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Loader2 } from "lucide-react";
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
import { assignCredits } from "./actions";

type CreditAssignClientProps = {
  initialUsers: AdminClientUserRow[];
  /** Set when the server could not load users (e.g. DB error). */
  fetchError?: string;
};

type CreditField = "email" | "server" | "time" | "campaign";

const EMPTY_FORM: Record<CreditField, string> = {
  email: "",
  server: "",
  time: "",
  campaign: "",
};

const FIELD_LABELS: Record<CreditField, string> = {
  email: "Email credits",
  server: "Server credits",
  time: "Time credits (hours)",
  campaign: "Campaign credits",
};

function displayName(u: AdminClientUserRow) {
  const name = u.full_name?.trim();
  return name ? `${name} — ${u.email}` : u.email;
}

function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function formatExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function CreditAssignClient({
  initialUsers,
  fetchError: initialFetchError,
}: CreditAssignClientProps) {
  const [users, setUsers] = useState<AdminClientUserRow[]>(initialUsers);
  const [fetchError, setFetchError] = useState<string | undefined>(initialFetchError);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<CreditField, string>>(EMPTY_FORM);
  const [fieldError, setFieldError] = useState<Partial<Record<CreditField, string>>>({});
  const [isSaving, startSaveTransition] = useTransition();

  // Re-sync local state when the server props change (e.g. after a `revalidatePath`
  // refresh). Using the "adjust state during render" pattern instead of an effect
  // avoids the cascading re-render that `setState`-in-`useEffect` causes.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [lastInitialUsers, setLastInitialUsers] = useState(initialUsers);
  if (lastInitialUsers !== initialUsers) {
    setLastInitialUsers(initialUsers);
    setUsers(initialUsers);
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
    const next = result.data ?? [];
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

  const empty = users.length === 0 && !refreshing && !fetchError;
  const showSkeleton = refreshing && users.length === 0;
  const disabled = refreshing || Boolean(fetchError) || empty;

  const parsed = useMemo(
    () => ({
      email: parseAmount(values.email),
      server: parseAmount(values.server),
      time: parseAmount(values.time),
      campaign: parseAmount(values.campaign),
    }),
    [values],
  );

  const hasAnyAmount =
    parsed.email > 0 || parsed.server > 0 || parsed.time > 0 || parsed.campaign > 0;

  function updateField(key: CreditField, raw: string) {
    setValues((prev) => ({ ...prev, [key]: raw }));
    if (fieldError[key]) {
      setFieldError((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function validateAll(): boolean {
    const next: Partial<Record<CreditField, string>> = {};
    (Object.keys(values) as CreditField[]).forEach((k) => {
      const raw = values[k].trim();
      if (!raw) return;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        next[k] = `${FIELD_LABELS[k]} must be a whole number ≥ 0.`;
      }
    });
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  function handleSave() {
    if (!userId) {
      toast.error("Select a user first.");
      return;
    }
    if (!validateAll()) return;
    if (!hasAnyAmount) {
      toast.error("Enter at least one credit amount greater than zero.");
      return;
    }

    startSaveTransition(async () => {
      const res = await assignCredits({
        userId,
        emailCredits: parsed.email,
        serverCredits: parsed.server,
        timeCreditsHours: parsed.time,
        campaignCredits: parsed.campaign,
      });
      if (!res.ok) {
        toast.error(res.error || "Could not save assignment.");
        return;
      }
      const expiry = res.data?.expiresAt;
      toast.success(
        expiry
          ? `Credits assigned. Expires ${formatExpiry(expiry)}.`
          : "Credits assigned.",
      );
      setValues(EMPTY_FORM);
      setFieldError({});
    });
  }

  return (
    <>
      <AdminPageHeader
        title="Credit Assignment"
        description="Assign email, server, time, and campaign credits to a client."
      />
      <div className="max-w-lg space-y-6 rounded-lg border border-gray-800 bg-[#111827] p-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-gray-300">User</Label>
            {refreshing && (
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Updating list…
              </span>
            )}
          </div>

          {fetchError && (
            <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              Could not load users: {fetchError}
            </p>
          )}

          {empty && !fetchError && (
            <p className="text-sm text-amber-200/90">
              No active client users yet. Add one under{" "}
              <span className="font-medium text-amber-100">User Management</span>, then refresh this
              page or return here after creating a user.
            </p>
          )}

          {showSkeleton ? (
            <Skeleton className="h-11 w-full bg-gray-700/80" aria-label="Loading users" />
          ) : empty ? (
            <div
              className="flex h-11 items-center rounded-md border border-dashed border-gray-600 bg-[#0F172A]/80 px-3 text-sm text-gray-500"
              role="status"
            >
              No active users to select
            </div>
          ) : (
            <Select
              value={userId}
              onValueChange={(v) => setUserId(v)}
              disabled={disabled || isSaving}
            >
              <SelectTrigger
                className={cn(
                  "border-gray-700 bg-[#0F172A] text-white",
                  disabled && "opacity-70",
                )}
                aria-busy={refreshing}
              >
                <SelectValue placeholder={refreshing ? "Loading users…" : "Select client"}>
                  {(value: string | null) => {
                    if (!value) return refreshing ? "Loading users…" : "Select client";
                    const u = users.find((x) => x.id === value);
                    return u ? displayName(u) : "Select client";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-gray-700 bg-[#111827]">
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {displayName(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-gray-300">Email credits</Label>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="border-gray-700 bg-[#0F172A] text-white"
              placeholder="0"
              value={values.email}
              onChange={(e) => updateField("email", e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldError.email) || undefined}
            />
            {fieldError.email && (
              <p className="text-xs text-red-400">{fieldError.email}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300">Server credits</Label>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="border-gray-700 bg-[#0F172A] text-white"
              placeholder="0"
              value={values.server}
              onChange={(e) => updateField("server", e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldError.server) || undefined}
            />
            {fieldError.server && (
              <p className="text-xs text-red-400">{fieldError.server}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300">Time credits (hours)</Label>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="border-gray-700 bg-[#0F172A] text-white"
              placeholder="0"
              value={values.time}
              onChange={(e) => updateField("time", e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldError.time) || undefined}
            />
            {fieldError.time ? (
              <p className="text-xs text-red-400">{fieldError.time}</p>
            ) : parsed.time > 0 ? (
              <p className="text-xs text-gray-500">
                All credits will expire {parsed.time} hour
                {parsed.time === 1 ? "" : "s"} after saving.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300">Campaign credits</Label>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="border-gray-700 bg-[#0F172A] text-white"
              placeholder="0"
              value={values.campaign}
              onChange={(e) => updateField("campaign", e.target.value)}
              disabled={isSaving}
              aria-invalid={Boolean(fieldError.campaign) || undefined}
            />
            {fieldError.campaign && (
              <p className="text-xs text-red-400">{fieldError.campaign}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="border-gray-600"
            onClick={() => void refreshUsers()}
            disabled={refreshing || isSaving}
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
            onClick={handleSave}
            disabled={!userId || disabled || isSaving || !hasAnyAmount}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save assignment"
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
