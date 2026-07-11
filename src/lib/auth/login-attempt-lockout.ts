export const LOGIN_MAX_ATTEMPTS = 3;
export const LOGIN_LOCKOUT_SECONDS = 30;

const STORAGE_KEY = "mm:login-lockout";

type LockoutState = {
  failedAttempts: number;
  lockedUntil: number | null;
};

function readState(): LockoutState {
  if (typeof window === "undefined") {
    return { failedAttempts: 0, lockedUntil: null };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { failedAttempts: 0, lockedUntil: null };
    const parsed = JSON.parse(raw) as LockoutState;
    return {
      failedAttempts: Number(parsed.failedAttempts) || 0,
      lockedUntil: typeof parsed.lockedUntil === "number" ? parsed.lockedUntil : null,
    };
  } catch {
    return { failedAttempts: 0, lockedUntil: null };
  }
}

function writeState(state: LockoutState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors.
  }
}

export function isInvalidCredentialsError(message: string): boolean {
  return message.toLowerCase().includes("invalid login credentials");
}

export function clearLoginAttemptLockout(): void {
  writeState({ failedAttempts: 0, lockedUntil: null });
}

export function getLoginLockoutSecondsLeft(now = Date.now()): number {
  const { lockedUntil } = readState();
  if (!lockedUntil || lockedUntil <= now) return 0;
  return Math.ceil((lockedUntil - now) / 1000);
}

export function isLoginLockedOut(now = Date.now()): boolean {
  return getLoginLockoutSecondsLeft(now) > 0;
}

export type FailedLoginAttemptResult =
  | { locked: false; attemptNumber: number }
  | { locked: true; lockoutSeconds: number };

/** Record one invalid-credentials failure; returns attempt number (1–2) or lockout. */
export function recordFailedLoginAttempt(now = Date.now()): FailedLoginAttemptResult {
  const state = readState();

  if (state.lockedUntil && state.lockedUntil > now) {
    return {
      locked: true,
      lockoutSeconds: Math.ceil((state.lockedUntil - now) / 1000),
    };
  }

  const nextAttempts = state.failedAttempts + 1;

  if (nextAttempts >= LOGIN_MAX_ATTEMPTS) {
    const lockedUntil = now + LOGIN_LOCKOUT_SECONDS * 1000;
    writeState({ failedAttempts: 0, lockedUntil });
    return { locked: true, lockoutSeconds: LOGIN_LOCKOUT_SECONDS };
  }

  writeState({ failedAttempts: nextAttempts, lockedUntil: null });
  return { locked: false, attemptNumber: nextAttempts };
}

export function failedAttemptLabel(attemptNumber: number): string {
  return `${attemptNumber}/${LOGIN_MAX_ATTEMPTS}`;
}
