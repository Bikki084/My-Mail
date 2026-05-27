/**
 * Normalized SMTP identity for duplicate detection (per user).
 * Matches DB unique index on (user_id, host, port, lower(trim(username))).
 */
export const DUPLICATE_SMTP_MESSAGE =
  "This SMTP account already exists. Please use a new SMTP or send using the existing one.";

export function smtpIdentityKey(
  host: string,
  port: number | string,
  username: string,
): string {
  const h = host.trim().toLowerCase();
  const portNum =
    typeof port === "number" ? port : parseInt(String(port ?? ""), 10);
  const p = Number.isFinite(portNum) ? portNum : 0;
  const u = username.trim().toLowerCase();
  return `${h}|${p}|${u}`;
}

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}
