"use client";

import * as React from "react";
import { AuthLoadingOverlay } from "@/components/auth/auth-loading-overlay";
import {
  clearAuthTransitionPending,
  isAuthTransitionPending,
} from "@/lib/auth/tab-session";

/** Keep the spinner up long enough for the dashboard shell + first paint. */
const MIN_VISIBLE_MS = 1600;
/** Never leave the overlay stuck if something goes wrong. */
const MAX_VISIBLE_MS = 10000;

/**
 * Continues the login spinner on the destination route until the dashboard
 * has mounted and painted (not just until auth API returns).
 */
export function AuthTransitionOverlay() {
  const [visible, setVisible] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return isAuthTransitionPending();
  });

  React.useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    const started = performance.now();
    let hideTimer: number | undefined;

    const hide = () => {
      if (cancelled) return;
      const elapsed = performance.now() - started;
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
      hideTimer = window.setTimeout(() => {
        if (!cancelled) setVisible(false);
      }, wait);
    };

    // Soft navigations usually already have readyState === "complete".
    // Wait two frames so layout/hydration can paint, then apply the floor.
    const settle = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(hide);
      });
    };

    if (document.readyState === "complete") {
      settle();
    } else {
      window.addEventListener("load", settle, { once: true });
    }

    const safety = window.setTimeout(() => {
      if (!cancelled) setVisible(false);
    }, MAX_VISIBLE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(safety);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      window.removeEventListener("load", settle);
    };
  }, [visible]);

  return (
    <AuthLoadingOverlay
      visible={visible}
      onExitComplete={clearAuthTransitionPending}
      title="Signing you in..."
      subtitle="Loading your workspace. Please wait."
    />
  );
}
