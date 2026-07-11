"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  clearTabSession,
  isTabSessionActive,
  performClientSignOut,
} from "@/lib/auth/tab-session";

/**
 * Protected dashboards require a tab-scoped session flag set at sign-in.
 * Surviving Supabase cookies alone are not enough — closing/reopening the tab,
 * using the back button, or returning to login clears access until re-auth.
 */
export function TabSessionGuard() {
  const router = useRouter();

  useEffect(() => {
    if (!isTabSessionActive()) {
      void performClientSignOut(router, { audit: false });
      return;
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      void performClientSignOut(router, { audit: false });
    };

    const onPopState = () => {
      queueMicrotask(() => {
        if (!isTabSessionActive()) {
          void performClientSignOut(router, { audit: false });
        }
      });
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPopState);
      clearTabSession();
    };
  }, [router]);

  return null;
}
