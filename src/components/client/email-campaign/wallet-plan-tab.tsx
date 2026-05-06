"use client";

import * as React from "react";
import { Loader2, Server, Timer, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { findPlan, formatServerLimit, PLANS, type Plan } from "@/lib/plans";
import {
  activatePlan,
  getWalletState,
  type WalletState,
} from "@/app/actions/wallet";
import { useWalletState } from "@/components/client/email-campaign/wallet-state-context";

export type WalletPlanTabProps = {
  /** When true, the activation button is hidden (no Supabase configured). */
  previewMode?: boolean;
};

function formatCredits(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

export function WalletPlanTab({
  previewMode = false,
}: WalletPlanTabProps) {
  const { state, setState, timer } = useWalletState();
  const [selectedPlanId, setSelectedPlanId] = React.useState<string | null>(null);
  const [isActivating, startActivation] = React.useTransition();
  const [refreshing, setRefreshing] = React.useState(false);

  const activePlan = state.activePlan;
  const expiresAtMs = activePlan ? Date.parse(activePlan.expiresAt) : NaN;
  const planRecord: Plan | undefined = activePlan
    ? findPlan(activePlan.planId)
    : undefined;

  const { now, elapsedPct, planRunning } = timer;

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await getWalletState();
      setState(next);
    } finally {
      setRefreshing(false);
    }
  }, [setState]);

  // When the timer hits zero, refresh from the server so the activation
  // controls re-enable and the audit reflects the real expired state.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!activePlan) return;
    if (!Number.isFinite(expiresAtMs)) return;
    if (now < expiresAtMs) return;
    if (refreshing) return;
    void refresh();
  }, [activePlan, expiresAtMs, now, refreshing, refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const balance = state.balance;
  const selectedPlan = selectedPlanId ? findPlan(selectedPlanId) : null;
  const insufficient = selectedPlan ? balance < selectedPlan.cost : false;
  const cannotActivate = previewMode || planRunning;

  function handleActivate() {
    if (!selectedPlan) {
      toast.error("Pick a plan first.");
      return;
    }
    if (insufficient) {
      toast.error(
        `Insufficient balance. Need ${formatCredits(selectedPlan.cost - balance)} more credits.`,
      );
      return;
    }
    startActivation(async () => {
      const res = await activatePlan(selectedPlan.id);
      if (!res.ok) {
        toast.error("Could not activate plan.", { description: res.error });
        return;
      }
      if (res.data) {
        setState(res.data);
      }
      setSelectedPlanId(null);
      toast.success(`Activated ${selectedPlan.label}.`);
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="border-zinc-800 bg-zinc-900/60 ring-zinc-800">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Wallet className="size-5 text-indigo-300" aria-hidden />
            <CardTitle className="text-base text-zinc-100">Wallet balance</CardTitle>
          </div>
          <CardDescription className="text-zinc-500">
            Credits added by your administrator. Spend them by activating a plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-zinc-50">
              {formatCredits(balance)}
            </span>
            <span className="text-sm text-zinc-500">credits</span>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
            Need a top-up? Contact your account admin to add credits to your wallet.
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-900/60 ring-zinc-800">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Timer className="size-5 text-emerald-300" aria-hidden />
            <CardTitle className="text-base text-zinc-100">Active plan</CardTitle>
          </div>
          <CardDescription className="text-zinc-500">
            {planRunning
              ? "Time runs whether or not you send. Plans cannot be stacked."
              : "Pick a plan to unlock SMTP server slots for a fixed time window."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {planRunning && activePlan ? (
            <ActivePlanPanel
              plan={planRecord}
              activePlan={activePlan}
              timeRemainingLabel={timer.formatHMS()}
              elapsedPct={elapsedPct}
            />
          ) : (
            <ActivatePlanForm
              balance={balance}
              selectedPlanId={selectedPlanId}
              onSelect={(id) => setSelectedPlanId(id)}
              onActivate={handleActivate}
              disabled={cannotActivate}
              isActivating={isActivating}
              insufficient={insufficient}
              previewMode={previewMode}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ActivePlanPanel({
  plan,
  activePlan,
  timeRemainingLabel,
  elapsedPct,
}: {
  plan: Plan | undefined;
  activePlan: NonNullable<WalletState["activePlan"]>;
  timeRemainingLabel: string;
  elapsedPct: number;
}) {
  const label = plan?.label ?? activePlan.planId;
  const serverText =
    activePlan.serversAllowed === null
      ? "Unlimited"
      : `${activePlan.serversAllowed}`;
  const expiresLocal = (() => {
    try {
      return new Date(activePlan.expiresAt).toLocaleString();
    } catch {
      return activePlan.expiresAt;
    }
  })();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-zinc-100">{label}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{plan?.description}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-zinc-500">
            <Server className="size-3.5" aria-hidden /> Servers
          </dt>
          <dd className="mt-0.5 font-semibold text-zinc-100">{serverText}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-zinc-500">
            <Timer className="size-3.5" aria-hidden /> Expires
          </dt>
          <dd className="mt-0.5 text-zinc-300 tabular-nums">{expiresLocal}</dd>
        </div>
      </dl>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Time remaining
          </span>
          <span className="font-mono text-base tabular-nums text-zinc-100">
            {timeRemainingLabel}
          </span>
        </div>
        <Progress
          value={elapsedPct}
          className="w-full [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-emerald-500/90"
        />
        <p className="text-[11px] text-zinc-500">
          The plan ends at the time above. Activate a new one once it expires.
        </p>
      </div>
    </div>
  );
}

function ActivatePlanForm({
  balance,
  selectedPlanId,
  onSelect,
  onActivate,
  disabled,
  isActivating,
  insufficient,
  previewMode,
}: {
  balance: number;
  selectedPlanId: string | null;
  onSelect: (id: string) => void;
  onActivate: () => void;
  disabled: boolean;
  isActivating: boolean;
  insufficient: boolean;
  previewMode: boolean;
}) {
  const selectedPlan = selectedPlanId ? findPlan(selectedPlanId) : null;
  const remainingAfter =
    selectedPlan && balance >= selectedPlan.cost ? balance - selectedPlan.cost : null;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="plan-select" className="text-zinc-300">
          Choose a plan
        </Label>
        <Select
          value={selectedPlanId}
          onValueChange={(v) => {
            if (v) onSelect(v);
          }}
          disabled={disabled || isActivating}
        >
          <SelectTrigger
            id="plan-select"
            className="h-auto min-h-9 w-full justify-between border-zinc-700 bg-zinc-950/60 py-2 text-left text-zinc-100 [&_[data-slot=select-value]]:line-clamp-2 [&_[data-slot=select-value]]:whitespace-normal"
          >
            <SelectValue placeholder="Select a plan">
              {(value: string | null) => {
                if (!value) return "Select a plan";
                const p = findPlan(value);
                return p ? p.label : "Select a plan";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            className="border-zinc-700 bg-zinc-900 !w-max max-w-[min(36rem,calc(100vw-1.5rem))] !min-w-[min(26rem,calc(100vw-1.5rem))]"
            alignItemWithTrigger={false}
            align="start"
          >
            {PLANS.map((p) => (
              <SelectItem
                key={p.id}
                value={p.id}
                className="h-auto min-h-11 items-start py-2 [&>span:first-of-type]:min-w-0 [&>span:first-of-type]:w-full [&>span:first-of-type]:shrink [&>span:first-of-type]:whitespace-normal"
              >
                <div className="flex min-w-0 flex-col gap-0.5 pr-1">
                  <span className="text-sm leading-snug text-zinc-100">
                    {p.label}
                  </span>
                  <span className="text-[11px] leading-snug text-zinc-500">
                    {formatServerLimit(p)} server
                    {p.serversAllowed === 1 ? "" : "s"} · {p.durationHours}h
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedPlan && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs">
          <dl className="grid grid-cols-2 gap-y-1 text-zinc-400">
            <dt>Cost</dt>
            <dd className="text-right tabular-nums text-zinc-100">
              {formatCredits(selectedPlan.cost)} credits
            </dd>
            <dt>Servers</dt>
            <dd className="text-right text-zinc-100">
              {formatServerLimit(selectedPlan)}
            </dd>
            <dt>Duration</dt>
            <dd className="text-right text-zinc-100">
              {selectedPlan.durationHours}h
            </dd>
            <dt>Balance after</dt>
            <dd className="text-right tabular-nums text-zinc-100">
              {remainingAfter === null
                ? "—"
                : `${formatCredits(remainingAfter)} credits`}
            </dd>
          </dl>
        </div>
      )}

      {insufficient && selectedPlan && (
        <p className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Need {formatCredits(selectedPlan.cost - balance)} more credits to
          activate this plan. Ask your admin to top up your wallet.
        </p>
      )}

      {previewMode && (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
          Sign in with Supabase to activate plans.
        </p>
      )}

      <Button
        type="button"
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
        onClick={onActivate}
        disabled={
          disabled || isActivating || !selectedPlan || insufficient
        }
      >
        {isActivating ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Activating…
          </>
        ) : (
          "Activate plan"
        )}
      </Button>
    </div>
  );
}
