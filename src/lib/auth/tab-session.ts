import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LOGIN_EVENT_BOOTSTRAP_KEY } from "@/components/auth/login-event-bootstrap";
import { isSupabaseAuthConfigured } from "@/lib/auth-config";
import { createClient } from "@/lib/supabase/client";

/** Tab-scoped flag: set only after a fresh sign-in in this browser tab. */
export const TAB_SESSION_KEY = "mm:tab-session";

/** Persists across the login → dashboard navigation so the spinner stays visible. */
export const AUTH_TRANSITION_KEY = "mm:auth-transition";

export function markAuthTransitionPending(): void {
  try {
    sessionStorage.setItem(AUTH_TRANSITION_KEY, "1");
  } catch {
    // Ignore storage errors (e.g. private mode).
  }
}

export function clearAuthTransitionPending(): void {
  try {
    sessionStorage.removeItem(AUTH_TRANSITION_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function isAuthTransitionPending(): boolean {
  try {
    return sessionStorage.getItem(AUTH_TRANSITION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTabSessionActive(): void {
  try {
    sessionStorage.setItem(TAB_SESSION_KEY, "1");
  } catch {
    // Ignore storage errors (e.g. private mode).
  }
}

export function clearTabSession(): void {
  try {
    sessionStorage.removeItem(TAB_SESSION_KEY);
    sessionStorage.removeItem(LOGIN_EVENT_BOOTSTRAP_KEY);
    sessionStorage.removeItem(AUTH_TRANSITION_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function isTabSessionActive(): boolean {
  try {
    return sessionStorage.getItem(TAB_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

type SignOutOptions = {
  audit?: boolean;
  redirectTo?: string;
};

/** Clear Supabase cookies and tab session, then send the user to the login screen. */
export async function performClientSignOut(
  router: AppRouterInstance,
  { audit = true, redirectTo = "/login" }: SignOutOptions = {},
): Promise<void> {
  clearTabSession();

  if (isSupabaseAuthConfigured()) {
    if (audit) {
      try {
        const { recordLogoutEvent } = await import("@/app/actions/auth-events");
        await recordLogoutEvent();
      } catch {
        // Non-fatal: logout audit is best-effort.
      }
    }
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // fall through — still send the user back to the login screen
    }
  }

  router.replace(redirectTo);
  router.refresh();
}
