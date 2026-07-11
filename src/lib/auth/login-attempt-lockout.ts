export const LOGIN_MAX_ATTEMPTS = 3;
export const LOGIN_LOCKOUT_SECONDS = 30;

const STORAGE_KEY = "mm:login-lockout-until";
const LEGACY_STORAGE_KEY = "mm:login-lockout";

function clearLegacyLockoutState(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function readLockedUntil(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeLockedUntil(lockedUntil: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (lockedUntil == null) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, String(lockedUntil));
  } catch {
    // Ignore storage errors.
  }
}

export function isInvalidCredentialsError(message: string): boolean {
  return message.toLowerCase().includes("invalid login credentials");
}

export function clearLoginAttemptLockout(): void {
  clearLegacyLockoutState();
  writeLockedUntil(null);
}

export function getLoginLockoutSecondsLeft(now = Date.now()): number {
  clearLegacyLockoutState();
  const lockedUntil = readLockedUntil();
  if (!lockedUntil || lockedUntil <= now) return 0;
  return Math.ceil((lockedUntil - now) / 1000);
}

export function isLoginLockedOut(now = Date.now()): boolean {
  return getLoginLockoutSecondsLeft(now) > 0;
}

export type FailedLoginAttemptResult =
  | { locked: false; attemptNumber: number }
  | { locked: true; lockoutSeconds: number };

/**
 * Record one invalid-credentials failure for the current login page session.
 * @param failedSoFar how many invalid attempts already happened in this session (0 on first fail)
 */
export function recordFailedLoginAttempt(
  failedSoFar: number,
  now = Date.now(),
): FailedLoginAttemptResult {
  const secondsLeft = getLoginLockoutSecondsLeft(now);
  if (secondsLeft > 0) {
    return { locked: true, lockoutSeconds: secondsLeft };
  }

  const attemptNumber = failedSoFar + 1;

  if (attemptNumber >= LOGIN_MAX_ATTEMPTS) {
    writeLockedUntil(now + LOGIN_LOCKOUT_SECONDS * 1000);
    return { locked: true, lockoutSeconds: LOGIN_LOCKOUT_SECONDS };
  }

  return { locked: false, attemptNumber };
}

export function failedAttemptLabel(attemptNumber: number): string {
  return `${attemptNumber}/${LOGIN_MAX_ATTEMPTS}`;
}
