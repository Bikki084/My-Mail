"use client";

import { useEffect } from "react";
import { recordLoginEvent } from "@/app/actions/auth-events";

/** Session-scoped key so we only log one `login` event per tab/session. */
const BOOTSTRAP_KEY = "mm:login-event-logged";

/**
 * On mount (inside an authenticated shell), ensure a `login` event exists for
 * the active session. Guarded by sessionStorage so repeated navigations don't
 * create duplicate rows. Also covers users who were already signed in before
 * `recordLoginEvent` was wired into the sign-in form.
 */
export function LoginEventBootstrap() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(BOOTSTRAP_KEY)) return;
      sessionStorage.setItem(BOOTSTRAP_KEY, "1");
    } catch {
      // Ignore storage errors (e.g. private mode). We'll just insert anyway.
    }
    void recordLoginEvent().catch(() => {
      // Best effort — no user-visible error for audit logging.
    });
  }, []);

  return null;
}

export { BOOTSTRAP_KEY as LOGIN_EVENT_BOOTSTRAP_KEY };
