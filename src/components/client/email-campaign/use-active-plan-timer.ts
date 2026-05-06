"use client";

import * as React from "react";
import type { WalletState } from "@/app/actions/wallet";

function formatHMS(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * 1s ticking clock + progress for an active plan. Also exposes `now` so the
 * caller can run a “plan just expired” refresh with the same time base as the UI.
 *
 * `now` stays `null` until after mount so the first server + client paints match
 * (avoids hydration mismatches on Progress `aria-valuenow` / countdown text).
 * Until then we use `startedAt` as the time base so elapsed% is 0 on both sides.
 */
export function useActivePlanTimer(activePlan: WalletState["activePlan"]) {
  const [now, setNow] = React.useState<number | null>(null);

  const expiresAtMs = activePlan ? Date.parse(activePlan.expiresAt) : NaN;
  const startedAtMs = activePlan ? Date.parse(activePlan.startedAt) : NaN;

  React.useEffect(() => {
    if (!activePlan || !Number.isFinite(expiresAtMs)) {
      return;
    }

    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activePlan, expiresAtMs]);

  const effectiveNow =
    now ??
    (Number.isFinite(startedAtMs) ? startedAtMs : Number.isFinite(expiresAtMs) ? expiresAtMs : 0);

  const remainingMs =
    activePlan?.expired
      ? 0
      : Number.isFinite(expiresAtMs)
        ? Math.max(0, expiresAtMs - effectiveNow)
        : 0;
  const totalMs =
    Number.isFinite(expiresAtMs) && Number.isFinite(startedAtMs)
      ? Math.max(1, expiresAtMs - startedAtMs)
      : 1;
  const elapsedPct = activePlan
    ? activePlan.expired
      ? 100
      : Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100))
    : 0;
  const planRunning = Boolean(activePlan && !activePlan.expired && remainingMs > 0);
  const remainingLabel = formatHMS(remainingMs);

  return {
    /** Current clock used for remaining time (after mount, live `Date.now()` ticks). */
    now: effectiveNow,
    remainingMs,
    elapsedPct,
    planRunning,
    remainingLabel,
    formatHMS: () => formatHMS(remainingMs),
  };
}
