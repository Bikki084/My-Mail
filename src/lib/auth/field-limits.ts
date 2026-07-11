/** RFC 5321 — maximum email address length. */
export const AUTH_EMAIL_MAX_LENGTH = 254;

/** Login / sign-in password field cap (prevents unbounded input). */
export const AUTH_PASSWORD_MAX_LENGTH = 128;

/** New password fields (reset / update password). */
export const AUTH_NEW_PASSWORD_MAX_LENGTH = 128;

export function clampToMaxLength(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
