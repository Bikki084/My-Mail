"use client";

import { Timer } from "lucide-react";
import { useWalletState } from "@/components/client/email-campaign/wallet-state-context";
import { cn } from "@/lib/utils";

/**
 * Compact ticking countdown in the top bar: left of the announcement bell
 * when a plan is active. Hidden when there is no running plan.
 */
export function PlanCountdownHeader({ previewMode }: { previewMode?: boolean }) {
  const { timer, state } = useWalletState();
  if (previewMode) return null;
  if (!timer.planRunning || !state.activePlan) return null;

  return (
    <div
      className={cn(
        "mr-0.5 flex max-w-[min(100%,11rem)] items-center gap-1.5 rounded-lg border border-emerald-800/50 bg-emerald-950/35 px-2 py-1.5",
        "text-emerald-100/95 shadow-sm shadow-emerald-950/20",
      )}
      title="Time remaining on your active plan"
    >
      <Timer className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
      <span className="min-w-0 truncate font-mono text-xs font-medium tabular-nums tracking-tight sm:text-sm">
        {timer.remainingLabel}
      </span>
    </div>
  );
}
