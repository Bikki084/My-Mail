/** RFC 5321 — maximum email address length. */
export const AUTH_EMAIL_MAX_LENGTH = 254;

/** Login / sign-in password field cap (prevents unbounded input). */
export const AUTH_PASSWORD_MAX_LENGTH = 128;

/** New password fields (reset / update password). */
export const AUTH_NEW_PASSWORD_MAX_LENGTH = 128;

/** Reject inputs longer than the allowed max (server-side — do not silently truncate). */
export function rejectIfTooLong(value: string, maxLength: number, label: string): string | null {
  if (value.length > maxLength) {
    return `${label} must be at most ${maxLength} characters.`;
  }
  return null;
}

/** Client-side UX only — prefer {@link rejectIfTooLong} on the server. */
export function clampToMaxLength(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
