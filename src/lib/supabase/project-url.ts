/**
 * Supabase **project** origin only: `https://<ref>.supabase.co`
 *
 * If `NEXT_PUBLIC_SUPABASE_URL` mistakenly includes `/rest/v1`, Auth calls become
 * paths like `.../rest/v1/auth/v1/token` and the API responds with
 * "Invalid path specified in request URL".
 */
export function supabaseProjectUrl(raw: string | undefined | null): string {
  if (raw == null) return "";
  let u = String(raw).trim();
  if (!u) return "";
  u = u.replace(/\/rest\/v1\/?$/i, "");
  u = u.replace(/\/+$/, "");
  return u;
}
